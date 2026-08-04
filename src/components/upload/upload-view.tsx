"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Upload, Loader2, X, Link as LinkIcon, Film, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  createSelfProducedRequest,
  getNextReelTitle,
} from "@/app/(app)/vault/actions";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";
import {
  generateThumbnail,
  thumbnailPathFor,
  safeStorageName,
} from "@/lib/thumbnails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Upload page — the model's entry point.
 *
 * She shoots a reel (based on an inspo IG link) in one or more takes and
 * drops ALL takes here. This registers one edit job (a content_request in
 * status "shooted") that a VA then picks up in the Editing tab and cuts
 * into one or more final videos.
 *
 * Mobile-first: big touch targets, single column, minimal typing (title
 * is auto-generated from content type + counter).
 */
// iOS hands us files with an EMPTY type for a lot of camera-roll videos
// (.MOV / HEVC especially), and some Android pickers do the same. Filtering
// on file.type alone silently discarded everything the model picked, which
// made the upload page look frozen. Fall back to the extension, and when in
// doubt keep the file — the picker's `accept` already constrains it.
const MEDIA_EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isMediaFile(f: File): boolean {
  if (f.type.startsWith("video/") || f.type.startsWith("image/")) return true;
  // Unknown/empty type → trust the extension, and accept if we can't tell.
  if (!f.type) return true;
  return !!MEDIA_EXT_MIME[extOf(f.name)];
}

/** Best-effort MIME so the vault/editing views can tell video from image. */
function resolveMime(f: File): string {
  if (f.type) return f.type;
  return MEDIA_EXT_MIME[extOf(f.name)] ?? "application/octet-stream";
}

export function UploadView({ personaId }: { personaId: string }) {
  const [inspoLink, setInspoLink] = useState("");
  const [isNsfw, setIsNsfw] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [previewTitle, setPreviewTitle] = useState("…");
  const [doneInfo, setDoneInfo] = useState<{ title: string; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNextReelTitle()
      .then((r) => !cancelled && setPreviewTitle(r.title))
      .catch(() => !cancelled && setPreviewTitle("Reel"));
    return () => {
      cancelled = true;
    };
    // Re-fetch after a successful upload resets doneInfo → back to form
  }, [doneInfo]);

  const handleFiles = useCallback((picked: FileList | File[]) => {
    const all = Array.from(picked);
    if (all.length === 0) return;
    const arr = all.filter(isMediaFile);
    if (arr.length === 0) {
      toast.error("Those files aren't photos or videos");
      return;
    }
    if (arr.length < all.length) {
      toast.warning(`${all.length - arr.length} file(s) skipped — not media`);
    }
    setFiles((prev) => [...prev, ...arr]);
  }, []);

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setInspoLink("");
    setIsNsfw(false);
    setFiles([]);
    setProgress({ done: 0, total: 0 });
  }

  async function handleSubmit() {
    if (files.length === 0) {
      toast.error("Add at least one take");
      return;
    }
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    try {
      await runUpload();
    } catch (err) {
      console.error("[upload] failed", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      // Never leave the button spinning — a stuck spinner is what made the
      // page look frozen with no way to retry.
      setUploading(false);
    }
  }

  async function runUpload() {
    const created = await createSelfProducedRequest({
      inspo_link: inspoLink.trim() || null,
      is_nsfw: isNsfw,
    });
    if (created.error || !created.request_id) {
      toast.error(created.error ?? "Failed to create job");
      return;
    }
    const requestId = created.request_id;
    const finalTitle = created.title ?? "";
    const supabase = createClient();
    let completed = 0;

    for (const file of files) {
      const uuid = crypto.randomUUID();
      const mime = resolveMime(file);
      const filePath = `personas/${personaId}/requests/${requestId}/raw/${uuid}_${safeStorageName(file.name)}`;

      const { error: upErr } = await supabase.storage
        .from("content-assets")
        .upload(filePath, file, { contentType: mime, upsert: true });
      if (upErr) {
        // Show the real reason — a silent skip is what made this look frozen.
        toast.error(`${file.name}: ${upErr.message}`);
        continue;
      }

      let thumbnailPath: string | null = null;
      try {
        const thumb = await generateThumbnail(file, mime);
        if (thumb) {
          const tPath = thumbnailPathFor(filePath);
          const { error: tErr } = await supabase.storage
            .from("content-assets")
            .upload(tPath, thumb, { contentType: "image/jpeg", upsert: true });
          if (!tErr) thumbnailPath = tPath;
        }
      } catch (err) {
        console.warn("[upload] thumbnail failed", err);
      }

      try {
        await createAssetRecord({
          request_id: requestId,
          stage: "raw",
          file_path: filePath,
          file_name: file.name,
          mime_type: mime,
          size_bytes: file.size,
          thumbnail_path: thumbnailPath,
        });
        completed++;
      } catch (err) {
        await supabase.storage.from("content-assets").remove([filePath]);
        if (thumbnailPath) await supabase.storage.from("content-assets").remove([thumbnailPath]);
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : "could not be saved"}`
        );
      }
      setProgress({ done: completed, total: files.length });
    }

    if (completed === 0) {
      toast.error("Nothing was uploaded — see the errors above");
      return;
    }
    setDoneInfo({ title: finalTitle, count: completed });
    reset();
  }

  // ── Success state ──
  if (doneInfo) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-2xl bg-green-500/15 p-4">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Sent to editing ✓</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{doneInfo.title}</span> —{" "}
            {doneInfo.count} take{doneInfo.count > 1 ? "s" : ""} sent to editing.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 pt-2">
          <Button onClick={() => setDoneInfo(null)} className="w-full gap-1.5">
            <Plus className="h-4 w-4" /> Upload another reel
          </Button>
          <Link href="/editing" className="w-full">
            <Button variant="outline" className="w-full">
              View editing queue
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop your takes for a reel — a VA will cut them.
        </p>
      </div>

      {/* Auto title */}
      <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Job (auto-named)
        </p>
        <p className="mt-0.5 text-base font-semibold">{previewTitle}</p>
      </div>

      {/* Inspo link */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <LinkIcon className="h-3.5 w-3.5" /> Inspo Link{" "}
          <span className="text-muted-foreground">(the reel you copied)</span>
        </Label>
        <Input
          value={inspoLink}
          onChange={(e) => setInspoLink(e.target.value)}
          placeholder="https://instagram.com/reel/…"
          disabled={uploading}
          className="h-11"
          inputMode="url"
        />
      </div>

      {/* NSFW */}
      <button
        type="button"
        onClick={() => setIsNsfw((v) => !v)}
        disabled={uploading}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
          isNsfw
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-green-500/40 bg-green-500/10 text-green-400"
        }`}
      >
        <span>{isNsfw ? "NSFW" : "SFW"}</span>
        <span className="text-[11px] uppercase tracking-wider opacity-70">tap to switch</span>
      </button>

      {/* Files / takes */}
      <div className="space-y-2">
        <Label>Takes</Label>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex min-h-[130px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/50 text-muted-foreground hover:border-primary/40 hover:bg-accent/20"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <Upload className="h-7 w-7" />
          <p className="text-sm font-medium">Tap to add takes</p>
          <p className="text-[11px] text-muted-foreground/70">
            Add all your takes for this one reel
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*,.mov,.MOV"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />

        {files.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-card px-3 py-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50">
                  <Film className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">Take {i + 1}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {f.name} · {(f.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
                {!uploading && (
                  <button
                    onClick={() => removeFile(i)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sticky submit on mobile */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border/50 bg-background/95 p-3 backdrop-blur-md md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-md">
          <Button
            onClick={handleSubmit}
            disabled={uploading || files.length === 0}
            className="h-12 w-full text-base"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Uploading…{" "}
                {progress.done}/{progress.total}
              </>
            ) : (
              `Send ${files.length || ""} take${files.length === 1 ? "" : "s"} to editing`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
