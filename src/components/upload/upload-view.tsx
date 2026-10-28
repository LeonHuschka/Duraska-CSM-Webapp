"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Film, Loader2, X, Link as LinkIcon, CheckCircle2, Plus, FileText } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  createSelfProducedRequest,
  getNextReelTitle,
} from "@/app/(app)/vault/actions";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";
import { generateThumbnail, safeStorageName } from "@/lib/thumbnails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

// Supabase enforces a project-wide upload cap that overrides any per-bucket
// setting (50 MB on the free plan). Anything above it fails with "exceeded
// the maximum allowed size" — after the whole file has been sent. Flag it up
// front instead so she doesn't waste minutes on a doomed upload.
// Must match the Supabase bucket / project Storage limit (currently 2 GB).
// If this is lower than the server's limit we reject files the server would
// happily accept; if it's higher she waits out a doomed upload.
const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 2048);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Not a limit — just the point where a single-request upload gets slow
// enough on a phone that she deserves a heads-up.
const SLOW_UPLOAD_BYTES = 300 * 1024 * 1024;

type FileState = {
  status: "pending" | "uploading" | "done" | "error";
  pct: number;
};

/** What the model sees of a take: a frame grabbed onto a canvas (iOS
 *  never paints a bare <video> that hasn't played), or the photo. */
function TakeThumb({ file }: { file: File }) {
  // null while grabbing, "" when the frame could not be read
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    generateThumbnail(file, resolveMime(file)).then((blob) => {
      if (cancelled) return;
      if (!blob) return setUrl("");
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file]);
  if (url === null) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!url) return <Film className="h-6 w-6 text-muted-foreground" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />;
}

/** Small circular progress ring shown per take while it uploads. */
function ProgressRing({ pct }: { pct: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 -rotate-90">
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-primary transition-all duration-300"
        strokeDasharray={c}
        strokeDashoffset={c - (Math.min(100, Math.max(0, pct)) / 100) * c}
      />
    </svg>
  );
}

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

/**
 * PUT a file to a Supabase signed upload URL via XHR so we get real byte
 * progress — the SDK's upload() gives us nothing to show, which is what made
 * a multi-minute upload look like a frozen spinner.
 */
function putWithProgress(
  signedUrl: string,
  file: File,
  mime: string,
  onProgress: (loadedBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", mime);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve();
      } else {
        reject(new Error(`upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.ontimeout = () => reject(new Error("upload timed out"));
    xhr.send(file);
  });
}

export function UploadView({ personaId }: { personaId: string }) {
  // Not every reel comes from a link — some she just has in her head, and
  // then the editor has nothing to look at unless she writes it down.
  const [source, setSource] = useState<"inspo" | "own">("inspo");
  const [inspoLink, setInspoLink] = useState("");
  const [notes, setNotes] = useState("");
  const [isNsfw, setIsNsfw] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Per take: shot in a Fansly outfit. Same order as files.
  const [fansly, setFansly] = useState<boolean[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pct, setPct] = useState(0);
  const [fileStates, setFileStates] = useState<FileState[]>([]);

  function setFileState(index: number, patch: Partial<FileState>) {
    setFileStates((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] ?? { status: "pending", pct: 0 }), ...patch };
      return next;
    });
  }
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
    const tooBig = arr.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length > 0) {
      toast.error(
        `${tooBig.length} take(s) are over the ${MAX_UPLOAD_MB} MB limit and will fail — send those via Telegram`,
        { duration: 8000 }
      );
    }
    const slow = arr.filter(
      (f) => f.size <= MAX_UPLOAD_BYTES && f.size > SLOW_UPLOAD_BYTES
    );
    if (slow.length > 0) {
      toast.warning(
        `${slow.length} big take(s) — keep this page open while they upload`,
        { duration: 6000 }
      );
    }
    setFiles((prev) => [...prev, ...arr]);
    setFansly((prev) => [...prev, ...arr.map(() => false)]);
  }, []);

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setFansly((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setInspoLink("");
    setIsNsfw(false);
    setFiles([]);
    setFansly([]);
    setProgress({ done: 0, total: 0 });
    setPct(0);
    setFileStates([]);
  }

  async function handleSubmit() {
    if (files.length === 0) {
      toast.error("Add at least one take");
      return;
    }
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    setPct(0);
    setFileStates(files.map(() => ({ status: "pending", pct: 0 })));
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
      notes: source === "own" ? notes.trim() || null : null,
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

    const sent = new Array<number>(files.length).fill(0);
    const pushPct = () => {
      const total = files.reduce((a, f) => a + f.size, 0) || 1;
      const done = sent.reduce((a, b) => a + b, 0);
      setPct(Math.min(99, Math.round((done / total) * 100)));
    };

    async function uploadOne(file: File, index: number) {
      const uuid = crypto.randomUUID();
      const mime = resolveMime(file);
      const filePath = `personas/${personaId}/requests/${requestId}/raw/${uuid}_${safeStorageName(file.name)}`;
      setFileState(index, { status: "uploading", pct: 0 });

      try {
        // Signed upload URL + XHR so we get real byte progress. Falls back
        // to the SDK upload if anything about the signed path misbehaves.
        const { data: signed } = await supabase.storage
          .from("content-assets")
          .createSignedUploadUrl(filePath);

        if (signed?.signedUrl) {
          await putWithProgress(signed.signedUrl, file, mime, (loaded) => {
            sent[index] = loaded;
            setFileState(index, {
              pct: Math.round((loaded / (file.size || 1)) * 100),
            });
            pushPct();
          });
        } else {
          const { error } = await supabase.storage
            .from("content-assets")
            .upload(filePath, file, { contentType: mime, upsert: true });
          if (error) throw new Error(error.message);
          sent[index] = file.size;
          setFileState(index, { pct: 100 });
          pushPct();
        }
      } catch (err) {
        setFileState(index, { status: "error" });
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`
        );
        return;
      }

      try {
        // No thumbnail here on purpose. Generating one means decoding the
        // whole video on her phone (tens of seconds per take) — the Vault
        // backfills thumbnails later instead, so she never waits for it.
        await createAssetRecord({
          request_id: requestId,
          stage: "raw",
          file_path: filePath,
          file_name: file.name,
          mime_type: mime,
          size_bytes: file.size,
          thumbnail_path: null,
          fansly: fansly[index] ?? false,
        });
        completed++;
        setFileState(index, { status: "done", pct: 100 });
        setProgress({ done: completed, total: files.length });
      } catch (err) {
        setFileState(index, { status: "error" });
        await supabase.storage.from("content-assets").remove([filePath]);
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : "could not be saved"}`
        );
      }
    }

    // Upload several takes at once instead of one after another.
    const queue = files.map((f, i) => ({ f, i }));
    const CONCURRENCY = 3;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await uploadOne(next.f, next.i);
        }
      })
    );
    setPct(100);

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

      {/* Where the idea came from */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { key: "inspo", label: "Copied a reel" },
            { key: "own", label: "My own idea" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setSource(opt.key)}
            disabled={uploading}
            className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
              source === opt.key
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/50 bg-card text-muted-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Inspo link */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <LinkIcon className="h-3.5 w-3.5" /> Inspo Link{" "}
          <span className="text-muted-foreground">
            {source === "inspo" ? "(the reel you copied)" : "(optional)"}
          </span>
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

      {/* Her brief — only for own ideas, where nothing else explains the reel */}
      {source === "own" && (
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Notes for the editor
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What should this reel be? Music, text on screen, the vibe, where to cut…"
            disabled={uploading}
            rows={4}
            className="text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Without a link this is all the editor has to go on.
          </p>
        </div>
      )}

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

      {/* Takes: one card each, the last card adds more */}
      <div
        className="space-y-2"
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
      >
        <Label>Takes</Label>
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
          <p className="text-[11px] text-muted-foreground">
            Tap <span className="font-semibold text-foreground">IG</span> on every take you shot in a Fansly
            outfit — it turns <span className="font-semibold text-sky-300">Fansly</span>.
            {fansly.some(Boolean) && (
              <span className="ml-1 font-medium text-sky-300">{fansly.filter(Boolean).length} Fansly</span>
            )}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {files.map((f, i) => {
            const st = fileStates[i];
            const tooBig = f.size > MAX_UPLOAD_BYTES;
            return (
              <div
                key={i}
                className={`relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-xl border-2 bg-muted/40 ${
                  tooBig ? "border-red-500" : fansly[i] ? "border-sky-400" : "border-transparent"
                }`}
              >
                <TakeThumb file={f} />
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Take {i + 1}
                </span>
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {st?.status === "uploading" ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <ProgressRing pct={st.pct} />
                    <span className="absolute text-[9px] font-semibold tabular-nums text-white">{st.pct}</span>
                  </div>
                ) : st?.status === "done" ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  </div>
                ) : st?.status === "error" ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <X className="h-7 w-7 text-red-400" />
                  </div>
                ) : null}
                {tooBig ? (
                  <span className="absolute inset-x-1.5 bottom-10 rounded-md bg-red-500/90 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                    Too large — max {MAX_UPLOAD_MB} MB
                  </span>
                ) : f.size > SLOW_UPLOAD_BYTES ? (
                  <span className="absolute inset-x-1.5 bottom-10 rounded-md bg-amber-500/90 px-1 py-0.5 text-center text-[9px] font-semibold text-black">
                    Big — takes a while
                  </span>
                ) : null}
                {/* Instagram or Fansly: one tap per take, so the editor
                    can tell the Fansly-outfit takes apart. */}
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setFansly((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                  className={`absolute inset-x-1.5 bottom-1.5 rounded-lg py-1.5 text-[11px] font-semibold backdrop-blur ${
                    fansly[i] ? "bg-sky-500 text-white" : "bg-black/60 text-white/90"
                  }`}
                >
                  {fansly[i] ? "Fansly" : "IG"}
                </button>
              </div>
            );
          })}
          {!uploading && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors ${
                dragOver
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Plus className="h-8 w-8" />
              {files.length === 0 && <span className="text-[11px] font-medium">Add takes</span>}
            </button>
          )}
        </div>
      </div>

      {/* Sticky submit on mobile */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border/50 bg-background/95 p-3 backdrop-blur-md md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-md space-y-2">
          {uploading && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                {pct}% · {progress.done}/{progress.total} takes done — keep this
                page open
              </p>
            </div>
          )}
          <Button
            onClick={handleSubmit}
            disabled={uploading || files.length === 0}
            className="h-12 w-full text-base"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Uploading… {pct}%
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
