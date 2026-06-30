"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Loader2, X, Link as LinkIcon, Camera } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  createSelfProducedRequest,
  getNextSelfProducedTitle,
} from "@/app/(app)/vault/actions";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";
import { generateThumbnail, thumbnailPathFor } from "@/lib/thumbnails";
import { Button } from "@/components/ui/button";
import { TrialBadge } from "@/components/ui/trial-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Self-Upload Dialog
 *
 * For when the model shoots her own content based on inspo she found
 * (IG accounts, etc.) — no pre-existing request. She drops in via the
 * Vault → fills in title + inspo link + files → app creates a new
 * content_request (status="shooted") + uploads each file as a "raw"
 * asset + generates thumbnails. Then the editor (you) picks it up.
 */

interface SelfUploadDialogProps {
  personaId: string;
  contentTypes: { id: string; name: string }[];
  onComplete: () => void;
}

export function SelfUploadDialog({
  personaId,
  contentTypes,
  onComplete,
}: SelfUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [inspoLink, setInspoLink] = useState("");
  // Content type is REQUIRED — auto-defaults to the first available type
  // so the title is always categorized (no more "Untitled #N").
  const [contentTypeId, setContentTypeId] = useState<string>(
    contentTypes[0]?.id ?? ""
  );
  const [isNsfw, setIsNsfw] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [previewTitle, setPreviewTitle] = useState<string>("…");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When dialog opens or content type changes, fetch the next title preview
  // from the server. Same logic that runs server-side on submit — so what
  // the user sees is what they get.
  useEffect(() => {
    if (!open) return;
    if (!contentTypeId) {
      setPreviewTitle("Pick a content type ↓");
      return;
    }
    let cancelled = false;
    setPreviewTitle("…");
    getNextSelfProducedTitle(contentTypeId)
      .then((r) => {
        if (!cancelled) setPreviewTitle(r.title);
      })
      .catch(() => {
        if (!cancelled) setPreviewTitle("?");
      });
    return () => {
      cancelled = true;
    };
  }, [open, contentTypeId]);

  function reset() {
    setInspoLink("");
    setContentTypeId(contentTypes[0]?.id ?? "");
    setIsNsfw(false);
    setIsTrial(false);
    setFiles([]);
    setProgress({ done: 0, total: 0 });
  }

  const handleFiles = useCallback((picked: FileList | File[]) => {
    const arr = Array.from(picked).filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("image/")
    );
    setFiles((prev) => [...prev, ...arr]);
  }, []);

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (files.length === 0) {
      toast.error("Pick at least one file");
      return;
    }
    if (!contentTypeId) {
      toast.error("Please pick a content type");
      return;
    }

    setUploading(true);
    setProgress({ done: 0, total: files.length });

    // 1. Create the content_request — title is computed server-side from
    //    content type + auto-incremented number.
    const created = await createSelfProducedRequest({
      inspo_link: inspoLink.trim() || null,
      content_type_id: contentTypeId,
      is_nsfw: isNsfw,
      is_trial: isTrial,
    });
    if (created.error || !created.request_id) {
      toast.error(created.error ?? "Failed to create request");
      setUploading(false);
      return;
    }
    const requestId = created.request_id;
    const finalTitle = created.title ?? "";

    const supabase = createClient();
    let completed = 0;

    // 2. Upload each file as a raw asset + generate thumbnail
    for (const file of files) {
      const uuid = crypto.randomUUID();
      const filePath = `personas/${personaId}/requests/${requestId}/raw/${uuid}_${file.name}`;

      const { error: upErr } = await supabase.storage
        .from("content-assets")
        .upload(filePath, file);
      if (upErr) {
        toast.error(`Failed: ${file.name}`);
        continue;
      }

      // Thumbnail (non-fatal — has its own timeout now)
      let thumbnailPath: string | null = null;
      try {
        const thumb = await generateThumbnail(file);
        if (thumb) {
          const tPath = thumbnailPathFor(filePath);
          const { error: tErr } = await supabase.storage
            .from("content-assets")
            .upload(tPath, thumb, {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (!tErr) thumbnailPath = tPath;
        }
      } catch (err) {
        console.warn("[self-upload] thumbnail failed", err);
      }

      try {
        await createAssetRecord({
          request_id: requestId,
          stage: "raw",
          file_path: filePath,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          thumbnail_path: thumbnailPath,
        });
        completed++;
      } catch (err) {
        console.error(err);
        await supabase.storage.from("content-assets").remove([filePath]);
        if (thumbnailPath) {
          await supabase.storage.from("content-assets").remove([thumbnailPath]);
        }
        toast.error(`Record failed: ${file.name}`);
      }
      setProgress({ done: completed, total: files.length });
    }

    setUploading(false);
    if (completed > 0) {
      toast.success(
        `${completed} file${completed > 1 ? "s" : ""} uploaded — "${finalTitle}" created`
      );
      reset();
      setOpen(false);
      onComplete();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (uploading) return; // don't allow closing mid-upload
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          Upload self-produced
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload self-produced content</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Auto-generated title preview */}
          <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Title (auto-generated)
            </p>
            <p className="mt-0.5 text-sm font-medium">{previewTitle}</p>
          </div>

          {/* Inspo Link */}
          <div className="space-y-1.5">
            <Label
              htmlFor="inspo"
              className="flex items-center gap-1.5 text-sm font-medium"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Inspo Link <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="inspo"
              value={inspoLink}
              onChange={(e) => setInspoLink(e.target.value)}
              placeholder="https://instagram.com/p/…"
              disabled={uploading}
            />
          </div>

          {/* Content Type + NSFW row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="type">
                Content Type <span className="text-red-400">*</span>
              </Label>
              <Select
                value={contentTypeId}
                onValueChange={setContentTypeId}
                disabled={uploading || contentTypes.length === 0}
              >
                <SelectTrigger
                  id="type"
                  className={
                    !contentTypeId ? "border-amber-500/60" : undefined
                  }
                >
                  <SelectValue placeholder="Required — pick one" />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nsfw">NSFW</Label>
              <button
                type="button"
                id="nsfw"
                onClick={() => setIsNsfw((v) => !v)}
                disabled={uploading}
                className={`flex h-9 w-full items-center justify-center rounded-md border text-sm font-medium transition-colors ${
                  isNsfw
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                    : "border-green-500/40 bg-green-500/10 text-green-400"
                }`}
              >
                {isNsfw ? "NSFW" : "SFW"}
              </button>
            </div>
          </div>

          {/* Trial Reel toggle — full width so it's prominent */}
          <button
            type="button"
            onClick={() => setIsTrial((v) => !v)}
            disabled={uploading}
            className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              isTrial
                ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-300"
                : "border-border/50 bg-card hover:bg-accent/30"
            }`}
          >
            <span className="flex items-center gap-2">
              <TrialBadge size="sm" />
              Trial Reel
            </span>
            <span className="text-[11px] uppercase tracking-wider opacity-70">
              {isTrial ? "on" : "off"}
            </span>
          </button>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label>Files</Label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`flex min-h-[80px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border/50 p-4 transition-colors hover:border-primary/50 hover:bg-accent/20 ${
                uploading ? "pointer-events-none opacity-60" : ""
              }`}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Tap to pick or drag files here
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
              <ul className="space-y-1 pt-1">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs"
                  >
                    <span className="truncate">{f.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-muted-foreground/60">
                        {(f.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      {!uploading && (
                        <button
                          onClick={() => removeFile(i)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={uploading || files.length === 0 || !contentTypeId}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading… {progress.done}/{progress.total}
              </>
            ) : (
              `Upload ${files.length} file${files.length === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
