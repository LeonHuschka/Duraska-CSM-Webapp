"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Film, Loader2, X, Link as LinkIcon, CheckCircle2, Plus, FileText } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  announceUpload,
  createSelfProducedRequest,
  getNextReelTitle,
} from "@/app/(app)/vault/actions";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";
import { quickVideoFrame, safeStorageName } from "@/lib/thumbnails";
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

/** A picked take. It starts uploading the moment she picks it, so by the
 *  time she has filled in the rest the big files are already on their way. */
type Take = {
  id: string;
  file: File;
  fansly: boolean;
  status: "waiting" | "uploading" | "done" | "error";
  pct: number;
  path: string;
};

// Upload a few takes side by side, not all at once.
const CONCURRENCY = 3;

// Phones decode one video at a time well; several at once stall them all.
let thumbQueue: Promise<unknown> = Promise.resolve();

/** What the model sees of a take: the photo itself, or a video's first
 *  frame grabbed onto a canvas. */
function TakeThumb({ file }: { file: File }) {
  // null while grabbing, "" when the frame could not be read
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    if (resolveMime(file).startsWith("image/")) {
      made = URL.createObjectURL(file);
      setUrl(made);
    } else {
      const job = thumbQueue.then(() => (cancelled ? null : quickVideoFrame(file)));
      thumbQueue = job.catch(() => null);
      job.then((blob) => {
        if (cancelled) return;
        if (!blob) return setUrl("");
        made = URL.createObjectURL(blob);
        setUrl(made);
      });
    }
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
  onProgress: (loadedBytes: number) => void,
  onStart?: (xhr: XMLHttpRequest) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onStart?.(xhr);
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
    xhr.onabort = () => reject(new Error("removed"));
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
  const [takes, setTakes] = useState<Take[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("…");
  const [doneInfo, setDoneInfo] = useState<{ title: string; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Upload bookkeeping that must not wait for a render.
  const queueRef = useRef<Take[]>([]);
  const activeRef = useRef(0);
  const xhrRef = useRef(new Map<string, XMLHttpRequest>());
  // id → uploaded or not, set the moment an upload stops
  const resultRef = useRef(new Map<string, boolean>());
  const finishedRef = useRef(new Map<string, () => void>());

  const patchTake = useCallback((id: string, patch: Partial<Take>) => {
    setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

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

  // Leaving mid-upload loses the takes — ask first.
  const busy = takes.some((t) => t.status === "uploading" || t.status === "waiting");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const uploadOne = useCallback(
    async (take: Take) => {
      const supabase = createClient();
      patchTake(take.id, { status: "uploading", pct: 0 });
      let ok = false;
      try {
        // Signed upload URL + XHR so we get real byte progress. Falls back
        // to the SDK upload if anything about the signed path misbehaves.
        const { data: signed } = await supabase.storage
          .from("content-assets")
          .createSignedUploadUrl(take.path);
        if (signed?.signedUrl) {
          await putWithProgress(
            signed.signedUrl,
            take.file,
            resolveMime(take.file),
            (loaded) => patchTake(take.id, { pct: Math.round((loaded / (take.file.size || 1)) * 100) }),
            (xhr) => xhrRef.current.set(take.id, xhr)
          );
        } else {
          const { error } = await supabase.storage
            .from("content-assets")
            .upload(take.path, take.file, { contentType: resolveMime(take.file), upsert: true });
          if (error) throw new Error(error.message);
        }
        ok = true;
        patchTake(take.id, { status: "done", pct: 100 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload failed";
        if (msg !== "removed") {
          patchTake(take.id, { status: "error" });
          toast.error(`A take did not upload: ${msg} — tap it to try again`);
        }
      } finally {
        resultRef.current.set(take.id, ok);
        xhrRef.current.delete(take.id);
        finishedRef.current.get(take.id)?.();
        finishedRef.current.delete(take.id);
      }
      return ok;
    },
    [patchTake]
  );

  const pump = useCallback(() => {
    while (activeRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      activeRef.current++;
      void uploadOne(next).finally(() => {
        activeRef.current--;
        pump();
      });
    }
  }, [uploadOne]);

  const enqueue = useCallback(
    (list: Take[]) => {
      queueRef.current.push(...list);
      pump();
    },
    [pump]
  );

  const handleFiles = useCallback(
    (picked: FileList | File[]) => {
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
          `${tooBig.length} take(s) are over the ${MAX_UPLOAD_MB} MB limit — send those via Telegram`,
          { duration: 8000 }
        );
      }
      if (arr.some((f) => f.size <= MAX_UPLOAD_BYTES && f.size > SLOW_UPLOAD_BYTES)) {
        toast.warning("Big take — keep this page open while it uploads", { duration: 6000 });
      }
      const fresh: Take[] = arr.map((file) => {
        const id = crypto.randomUUID();
        return {
          id,
          file,
          fansly: false,
          status: file.size > MAX_UPLOAD_BYTES ? "error" : "waiting",
          pct: 0,
          // Not under a job yet — the job is made on Send. Nothing reads
          // the folder layout, the path is stored on the asset as is.
          path: `personas/${personaId}/takes/${id}_${safeStorageName(file.name)}`,
        };
      });
      setTakes((prev) => [...prev, ...fresh]);
      enqueue(fresh.filter((t) => t.status === "waiting"));
    },
    [enqueue, personaId]
  );

  function retry(take: Take) {
    if (take.file.size > MAX_UPLOAD_BYTES) return;
    resultRef.current.delete(take.id);
    patchTake(take.id, { status: "waiting", pct: 0 });
    enqueue([take]);
  }

  function removeTake(take: Take) {
    queueRef.current = queueRef.current.filter((t) => t.id !== take.id);
    xhrRef.current.get(take.id)?.abort();
    if (take.status === "done") {
      void createClient().storage.from("content-assets").remove([take.path]);
    }
    setTakes((prev) => prev.filter((t) => t.id !== take.id));
  }

  /** Resolves once every take has stopped uploading, one way or the other. */
  function allSettled(list: Take[]) {
    return Promise.all(
      list
        .filter((t) => t.file.size <= MAX_UPLOAD_BYTES && !resultRef.current.has(t.id))
        .map((t) => new Promise<void>((res) => finishedRef.current.set(t.id, res)))
    );
  }

  function reset() {
    setInspoLink("");
    setNotes("");
    setIsNsfw(false);
    setTakes([]);
    resultRef.current.clear();
  }

  async function handleSubmit() {
    if (takes.length === 0) {
      toast.error("Add at least one take");
      return;
    }
    setSubmitting(true);
    try {
      await allSettled(takes);
      const ready = takes.filter((t) => resultRef.current.get(t.id) === true);
      if (ready.length === 0) {
        toast.error("No take finished uploading — tap the failed ones to retry");
        return;
      }
      const created = await createSelfProducedRequest({
        inspo_link: inspoLink.trim() || null,
        notes: source === "own" ? notes.trim() || null : null,
        is_nsfw: isNsfw,
      });
      if (created.error || !created.request_id) {
        toast.error(created.error ?? "Failed to create job");
        return;
      }
      // Keep the inspo reel with the job — runs on its own, she doesn't wait.
      if (inspoLink.trim()) {
        void fetch(`/api/links/request-video?id=${created.request_id}`, { method: "POST", keepalive: true }).catch(
          () => null
        );
      }
      let saved = 0;
      for (const t of ready) {
        try {
          // No thumbnail here on purpose — the Vault backfills them later.
          await createAssetRecord({
            request_id: created.request_id,
            stage: "raw",
            file_path: t.path,
            file_name: t.file.name,
            mime_type: resolveMime(t.file),
            size_bytes: t.file.size,
            thumbnail_path: null,
            fansly: t.fansly,
          });
          saved++;
        } catch (err) {
          toast.error(`A take could not be saved: ${err instanceof Error ? err.message : "error"}`);
        }
      }
      if (ready.length < takes.length) {
        toast.warning(`${takes.length - ready.length} take(s) failed and were left out`);
      }
      // Today's "shot new content" line in TALK — never holds up her upload.
      if (saved > 0) await announceUpload().catch(() => null);
      setDoneInfo({ title: created.title ?? "", count: saved });
      reset();
    } catch (err) {
      console.error("[upload] failed", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      // Never leave the button spinning — a stuck spinner is what made the
      // page look frozen with no way to retry.
      setSubmitting(false);
    }
  }

  const totalBytes = takes.reduce((a, t) => a + t.file.size, 0) || 1;
  const sentBytes = takes.reduce((a, t) => a + (t.file.size * t.pct) / 100, 0);
  const pct = Math.round((sentBytes / totalBytes) * 100);
  const doneCount = takes.filter((t) => t.status === "done").length;
  const fanslyCount = takes.filter((t) => t.fansly).length;

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
            disabled={submitting}
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
          disabled={submitting}
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
            disabled={submitting}
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
        disabled={submitting}
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

        {takes.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Tap <span className="font-semibold text-foreground">IG</span> on every take you shot in a Fansly
            outfit — it turns <span className="font-semibold text-sky-300">Fansly</span>.
            {fanslyCount > 0 && <span className="ml-1 font-medium text-sky-300">{fanslyCount} Fansly</span>}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {takes.map((t, i) => {
            const tooBig = t.file.size > MAX_UPLOAD_BYTES;
            return (
              <div
                key={t.id}
                className={`relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-xl border-2 bg-muted/40 ${
                  tooBig ? "border-red-500" : t.fansly ? "border-sky-400" : "border-transparent"
                }`}
              >
                <TakeThumb file={t.file} />
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Take {i + 1}
                </span>
                {!submitting && (
                  <button
                    type="button"
                    onClick={() => removeTake(t)}
                    className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {t.status === "done" ? (
                  <span className="absolute bottom-10 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  </span>
                ) : t.status === "error" ? (
                  <button
                    type="button"
                    onClick={() => retry(t)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white"
                  >
                    <X className="h-7 w-7 text-red-400" />
                    <span className="px-2 text-center text-[10px] font-semibold">
                      {tooBig ? `Too large — max ${MAX_UPLOAD_MB} MB` : "Failed — tap to retry"}
                    </span>
                  </button>
                ) : (
                  // Upload progress of the whole file, from the moment she picks it.
                  <div className="absolute inset-x-1.5 bottom-10 rounded-md bg-black/60 px-1.5 py-1">
                    <div className="flex justify-between text-[9px] font-semibold tabular-nums text-white">
                      <span>{t.status === "waiting" ? "waiting" : "uploading"}</span>
                      <span>{t.pct}%</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${t.pct}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Instagram or Fansly: one tap per take, so the editor
                    can tell the Fansly-outfit takes apart. */}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => patchTake(t.id, { fansly: !t.fansly })}
                  className={`absolute inset-x-1.5 bottom-1.5 rounded-lg py-1.5 text-[11px] font-semibold backdrop-blur ${
                    t.fansly ? "bg-sky-500 text-white" : "bg-black/60 text-white/90"
                  }`}
                >
                  {t.fansly ? "Fansly" : "IG"}
                </button>
              </div>
            );
          })}
          {!submitting && (
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
              {takes.length === 0 && <span className="text-[11px] font-medium">Add takes</span>}
            </button>
          )}
        </div>
      </div>

      {/* Sticky submit on mobile */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border/50 bg-background/95 p-3 backdrop-blur-md md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-md space-y-2">
          {busy && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                {pct}% · {doneCount}/{takes.length} takes uploaded — keep this page open
              </p>
            </div>
          )}
          <Button
            onClick={handleSubmit}
            disabled={submitting || takes.length === 0}
            className="h-12 w-full text-base"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {busy ? `Finishing uploads… ${pct}%` : "Sending…"}
              </>
            ) : (
              `Send ${takes.length || ""} take${takes.length === 1 ? "" : "s"} to editing`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
