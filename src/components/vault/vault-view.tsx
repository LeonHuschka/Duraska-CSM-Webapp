"use client";

import { useMemo, useState, useRef, useEffect, useTransition, useCallback } from "react";
import { Download, Search, X, Archive, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  markAssetPostedFromVault,
  unmarkAssetPostedFromVault,
  setRequestNsfw,
  saveAssetThumbnail,
} from "@/app/(app)/vault/actions";
import {
  generateThumbnailFromUrl,
  thumbnailPathFor,
} from "@/lib/thumbnails";
import { createClient } from "@/lib/supabase/client";
import type { VaultAsset } from "@/app/(app)/vault/page";

// ─── Platform display config ───────────────────────────────────────────────
const PLATFORM_LABELS: Record<string, string> = {
  fansly: "Fansly",
  instagram: "IG",
  tiktok: "TikTok",
  other: "Other",
};

const PLATFORM_DOT: Record<string, string> = {
  fansly: "bg-blue-500",
  instagram: "bg-pink-500",
  tiktok: "bg-slate-400",
  other: "bg-gray-500",
};

const STATUS_COLOR: Record<string, string> = {
  posted: "bg-green-500/80 text-white",
  scheduled: "bg-amber-500/80 text-white",
  planned: "bg-gray-500/60 text-white",
};

const STATUS_ICON: Record<string, string> = {
  posted: "✓",
  scheduled: "⏳",
  planned: "·",
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Map common MIME types to file extensions. iOS Photos / Android Gallery
// only recognise a file as media when the extension matches.
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

function ensureExtension(fileName: string, mimeType: string): string {
  const expected = MIME_TO_EXT[mimeType.toLowerCase()];
  // No mapping → leave the name as-is.
  if (!expected) return fileName;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(`.${expected}`)) return fileName;
  // For jpeg, accept .jpeg as well
  if (expected === "jpg" && lower.endsWith(".jpeg")) return fileName;
  // Strip any existing extension and append the right one
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  return `${base}.${expected}`;
}

const MARK_POSTED_PLATFORMS = [
  { value: "fansly", label: "Fansly" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
] as const;

// ─── Single vault card ──────────────────────────────────────────────────────
// Uses IntersectionObserver so videos/images only load when they enter the viewport.
function VaultCard({
  asset,
  onUpdate,
  onUpdateNsfw,
  onVisible,
}: {
  asset: VaultAsset;
  onUpdate: (id: string, platformStatus: Record<string, string>) => void;
  onUpdateNsfw: (requestId: string, isNsfw: boolean) => void;
  onVisible: (asset: VaultAsset) => void;
}) {
  const isVideo = asset.mime_type?.startsWith("video/");
  const isImage = asset.mime_type?.startsWith("image/");

  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileReady, setFileReady] = useState(false);
  const cachedFileRef = useRef<File | null>(null);
  const inflightRef = useRef<Promise<File> | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Lazy-load: observe when card enters viewport. Also ping the parent
  // so it can auto-enqueue this asset for thumbnail backfill if missing.
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          onVisibleRef.current(asset);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // start loading 200px before entering view
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [asset]);

  const platformEntries = Object.entries(asset.platformStatus);
  const isUnposted = platformEntries.length === 0;

  function handleMediaClick() {
    if (!isVideo) return;
    if (playing) {
      // <video> is mounted when playing — pause it via the ref
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      // Not playing yet → mount the <video autoPlay> element. Don't
      // touch videoRef here, it's null until the next render.
      setPlaying(true);
    }
  }

  // Two-phase download for iOS Safari user-activation problem:
  //
  // The Web Share API's "Save Video" option only appears when navigator.share
  // is called within a fresh user activation (~5 s window). Large videos
  // take longer to fetch than that, so by the time share() runs, iOS has
  // forgotten the click and falls back to a stripped-down save dialog
  // (Files / Drive only).
  //
  // To work around it:
  //   1. Pre-fetch on pointerdown (gives a head start before click fires)
  //   2. Cache the resulting File in a ref so subsequent clicks are instant
  //   3. If the file is ready by click time → share immediately
  //   4. If not → download with progress, then prompt the user to tap again;
  //      that second click runs share() instantly within fresh activation.
  async function fetchAsFile(): Promise<File> {
    setProgress(0);
    const res = await fetch(asset.signedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = parseInt(res.headers.get("content-length") || "0", 10);

    // Stream so we can show progress
    let blob: Blob;
    if (res.body && total > 0) {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as BlobPart);
        received += value.byteLength;
        setProgress(Math.round((received / total) * 100));
      }
      blob = new Blob(chunks);
    } else {
      blob = await res.blob();
    }
    setProgress(null);

    const mimeType =
      asset.mime_type ||
      (blob.type && blob.type !== "application/octet-stream" ? blob.type : null) ||
      "application/octet-stream";
    const filename = ensureExtension(asset.file_name, mimeType);
    return new File([blob], filename, {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  function ensureFile(): Promise<File> {
    if (cachedFileRef.current) return Promise.resolve(cachedFileRef.current);
    if (inflightRef.current) return inflightRef.current;
    const p = fetchAsFile().then((f) => {
      cachedFileRef.current = f;
      setFileReady(true);
      return f;
    });
    inflightRef.current = p;
    p.finally(() => {
      inflightRef.current = null;
    });
    return p;
  }

  // Pointer-down on the download button → start fetching early so the file
  // is more likely to be ready by the time the click event fires.
  function handleDownloadPointerDown() {
    if (cachedFileRef.current || inflightRef.current) return;
    void ensureFile().catch(() => {});
  }

  async function shareOrDownloadFile(file: File) {
    const isTouch =
      typeof navigator !== "undefined" &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isTouch && typeof navigator?.share === "function") {
      const canShareFile =
        typeof navigator.canShare === "function"
          ? navigator.canShare({ files: [file] })
          : true;
      if (canShareFile) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          console.warn("Web Share failed, falling back to download", err);
        }
      }
    }

    // Desktop / fallback: blob-URL download
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;

    // File already cached → share immediately within user activation.
    if (cachedFileRef.current) {
      setDownloading(true);
      try {
        await shareOrDownloadFile(cachedFileRef.current);
        setFileReady(false);
      } finally {
        setDownloading(false);
      }
      return;
    }

    // Otherwise: prepare the file, then ask the user to tap again. The
    // second tap will fall into the cached branch above and pop the
    // share sheet instantly with full options ("Save Video" etc.).
    setDownloading(true);
    try {
      await ensureFile();
      toast.success("Bereit – nochmal antippen zum Speichern", {
        duration: 6000,
      });
    } catch (err) {
      console.error("Download failed", err);
      toast.error("Download fehlgeschlagen");
    } finally {
      setDownloading(false);
    }
  }

  function toggleNsfw(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !asset.is_nsfw;
    startTransition(async () => {
      // Optimistic
      onUpdateNsfw(asset.request_id, next);
      const result = await setRequestNsfw({
        request_id: asset.request_id,
        is_nsfw: next,
      });
      if (result.error) {
        toast.error(result.error);
        onUpdateNsfw(asset.request_id, !next); // revert
      } else {
        toast.success(next ? "Marked as NSFW" : "Marked as SFW");
      }
    });
  }

  function togglePosted(platform: string) {
    const isPosted = asset.platformStatus[platform] === "posted";
    startTransition(async () => {
      // Optimistic update
      const next = { ...asset.platformStatus };
      if (isPosted) {
        delete next[platform];
      } else {
        next[platform] = "posted";
      }
      onUpdate(asset.id, next);

      const result = isPosted
        ? await unmarkAssetPostedFromVault({
            request_id: asset.request_id,
            platform,
          })
        : await markAssetPostedFromVault({
            request_id: asset.request_id,
            platform,
          });

      if (result.error) {
        toast.error(result.error);
        // Revert
        onUpdate(asset.id, asset.platformStatus);
      } else {
        toast.success(
          isPosted
            ? `Unmarked as posted on ${platform}`
            : `Marked as posted on ${platform}`
        );
      }
    });
  }

  return (
    <div
      ref={cardRef}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/30 bg-card transition-all duration-200 hover:border-border/60 hover:shadow-md"
    >
      {/* ── Thumbnail ── */}
      <div
        className="relative aspect-[9/16] w-full overflow-hidden bg-muted/30 cursor-pointer"
        onClick={handleMediaClick}
      >
        {/* Media — only rendered once visible.
            Display priority:
              1. If playing → render <video preload="auto" autoplay>
              2. Else if thumbnailUrl exists → tiny <img> (~30 KB)
              3. Else → dark placeholder w/ play icon (no egress) */}
        {visible && isVideo && playing && (
          <video
            ref={videoRef}
            key={asset.id}
            src={asset.signedUrl}
            playsInline
            preload="auto"
            autoPlay
            controls
            onEnded={() => setPlaying(false)}
            className="h-full w-full object-cover"
          />
        )}
        {visible && isVideo && !playing && asset.thumbnailUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.thumbnailUrl}
              alt={asset.file_name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
            {/* Play icon overlay — semi-transparent so thumbnail still visible */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-full bg-black/50 p-3 backdrop-blur-sm">
                <svg
                  className="h-6 w-6 text-white/90"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </>
        )}
        {visible && isVideo && !playing && !asset.thumbnailUrl && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 via-slate-900 to-black">
            <div className="rounded-full bg-white/10 p-3 backdrop-blur-sm">
              <svg
                className="h-7 w-7 text-white/90"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="px-2 text-center text-[9px] font-medium text-white/40 line-clamp-2">
              Tap to play
            </span>
          </div>
        )}
        {visible && isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl ?? asset.signedUrl}
            alt={asset.file_name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
        {!visible && (
          // Placeholder until card enters viewport
          <div className="h-full w-full animate-pulse bg-muted/40" />
        )}

        {/* Top gradient */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />

        {/* Top-left: NSFW/SFW badge (click to toggle) + stage */}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <button
            onClick={toggleNsfw}
            disabled={pending}
            title="Click to toggle NSFW / SFW"
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide transition-all hover:ring-2 hover:ring-white/40 disabled:opacity-60 w-fit ${
              asset.is_nsfw ? "bg-blue-600/90 text-white" : "bg-green-600/90 text-white"
            }`}
          >
            {pending ? "…" : asset.is_nsfw ? "NSFW" : "SFW"}
          </button>
          <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/80 capitalize w-fit">
            {asset.stage}
          </span>
        </div>

        {/* Top-right: Action buttons — always visible on mobile, hover on desktop */}
        <div className="absolute right-2 top-2 flex items-center gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          {/* Mark as posted */}
          <Popover open={postOpen} onOpenChange={setPostOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                title="Mark as posted"
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-44 p-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Mark posted on
              </div>
              {MARK_POSTED_PLATFORMS.map((p) => {
                const isPosted = asset.platformStatus[p.value] === "posted";
                return (
                  <button
                    key={p.value}
                    onClick={() => {
                      togglePosted(p.value);
                      setPostOpen(false);
                    }}
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${PLATFORM_DOT[p.value]}`}
                      />
                      {p.label}
                    </span>
                    {isPosted && <Check className="h-3.5 w-3.5 text-green-500" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          {/* Download — two-phase on iOS:
              1. First tap fetches the file (loader + %)
              2. Button turns green and pulses when ready
              3. Second tap fires share-sheet with full options */}
          <button
            onClick={handleDownload}
            onPointerDown={handleDownloadPointerDown}
            disabled={downloading}
            className={`relative flex items-center justify-center rounded-full text-white transition-all disabled:opacity-80 ${
              fileReady
                ? "h-7 w-fit gap-1 bg-green-600/90 px-2 hover:bg-green-600 animate-pulse"
                : "h-7 w-7 bg-black/50 hover:bg-black/70"
            }`}
            title={fileReady ? "Bereit – tippen zum Speichern" : "Download"}
          >
            {downloading && progress !== null ? (
              <span className="text-[10px] font-semibold tabular-nums">
                {progress}%
              </span>
            ) : downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : fileReady ? (
              <>
                <Download className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold">Save</span>
              </>
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Bottom gradient + platform tags */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pointer-events-none">
          {isUnposted ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/60">
              Not posted yet
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {platformEntries.map(([platform, status]) => (
                <span
                  key={platform}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLOR[status] ?? "bg-gray-500/80 text-white"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT[platform] ?? "bg-gray-400"}`} />
                  {PLATFORM_LABELS[platform] ?? platform}
                  <span>{STATUS_ICON[status] ?? ""}</span>
                </span>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Meta below thumbnail ── */}
      <div className="px-2.5 py-2">
        <p className="text-xs font-medium leading-tight line-clamp-1 text-foreground">
          {asset.request_title}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/60 truncate">
          {asset.size_bytes ? formatBytes(asset.size_bytes) : asset.file_name}
        </p>
      </div>
    </div>
  );
}

const PAGE_SIZE = 40;

// ─── Vault view ─────────────────────────────────────────────────────────────
const STAGE_OPTIONS = [
  { value: "all",    label: "All" },
  { value: "raw",    label: "Raw" },
  { value: "edited", label: "Edited ✓" },
  { value: "final",  label: "Final" },
] as const;
const NSFW_OPTIONS = ["all", "sfw", "nsfw"] as const;

const PLATFORM_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "unposted", label: "Not posted" },
  { value: "fansly", label: "Fansly" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
];

export function VaultView({ assets }: { assets: VaultAsset[] }) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("edited");
  const [nsfwFilter, setNsfwFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Local copy so the "mark posted" UI can update optimistically without
  // waiting for a server round-trip / revalidation.
  const [localAssets, setLocalAssets] = useState(assets);
  useEffect(() => {
    setLocalAssets(assets);
  }, [assets]);

  function handleAssetUpdate(id: string, platformStatus: Record<string, string>) {
    setLocalAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, platformStatus } : a))
    );
  }

  function handleNsfwUpdate(requestId: string, isNsfw: boolean) {
    // is_nsfw lives on the content_request, so update every asset that
    // belongs to the same request.
    setLocalAssets((prev) =>
      prev.map((a) => (a.request_id === requestId ? { ...a, is_nsfw: isNsfw } : a))
    );
  }

  // ── Thumbnail backfill: shared queue + worker pool.
  //
  //  Two ways assets enter the queue:
  //    A. Auto-on-visibility — when a card without a thumbnail scrolls
  //       into view, it's enqueued. So as you browse, the gaps fill in
  //       silently in the background. No button needed.
  //    B. Manual — the "Generate all" button enqueues every missing one
  //       at once for impatient cases.
  //
  //  Workers prefer the URL-based generator (browser fetches ~1-5 MB of
  //  each video instead of the full 50-200 MB) and fall back to the
  //  blob path on failure. CONCURRENCY=2 is a balance — enough to feel
  //  responsive, not so many that we spike egress or memory.
  const CONCURRENCY = 2;
  const queueRef = useRef<VaultAsset[]>([]);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const activeWorkersRef = useRef(0);
  const [bf, setBf] = useState({ done: 0, queued: 0, running: false });

  const processAsset = useCallback(async (asset: VaultAsset) => {
    const supabase = createClient();
    try {
      // URL-based smart fetch only. Browser fetches ~1-5 MB instead of
      // the full file. If this fails (timeout, CORS, weird codec) we
      // SKIP the asset rather than falling back to a full blob download
      // — that fallback used to silently spike egress to 100 MB+ per
      // failed asset. Skipped assets can be picked up later by the
      // local Node script (scripts/backfill-thumbnails.mjs) which uses
      // ffmpeg + range requests and is far more reliable.
      const thumb = await generateThumbnailFromUrl(
        asset.signedUrl,
        asset.mime_type
      );
      if (!thumb) return;

      const tPath = thumbnailPathFor(asset.file_path);
      const { error: upErr } = await supabase.storage
        .from("content-assets")
        .upload(tPath, thumb, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { error: saveErr } = await saveAssetThumbnail({
        asset_id: asset.id,
        thumbnail_path: tPath,
      });
      if (saveErr) throw new Error(saveErr);

      const { data: signed } = await supabase.storage
        .from("content-assets")
        .createSignedUrl(tPath, 3600);
      setLocalAssets((prev) =>
        prev.map((a) =>
          a.id === asset.id
            ? { ...a, thumbnailUrl: signed?.signedUrl ?? null, thumbnailPath: tPath }
            : a
        )
      );
    } catch (err) {
      console.warn("[backfill] asset failed", asset.id, err);
    }
  }, []);

  const drainQueue = useCallback(async () => {
    while (activeWorkersRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const asset = queueRef.current.shift()!;
      activeWorkersRef.current++;
      setBf((s) => ({ ...s, running: true }));
      // Fire and forget — worker decrements + drains again on completion
      (async () => {
        await processAsset(asset);
        activeWorkersRef.current--;
        setBf((s) => ({
          done: s.done + 1,
          queued: queueRef.current.length,
          running: activeWorkersRef.current > 0 || queueRef.current.length > 0,
        }));
        drainQueue();
      })();
    }
  }, [processAsset]);

  const enqueueAsset = useCallback(
    (asset: VaultAsset) => {
      // Skip if already has a thumbnail or already in/processed by the queue
      if (asset.thumbnailUrl) return;
      if (enqueuedRef.current.has(asset.id)) return;
      enqueuedRef.current.add(asset.id);
      queueRef.current.push(asset);
      setBf((s) => ({ ...s, queued: queueRef.current.length }));
      drainQueue();
    },
    [drainQueue]
  );

  // Auto-run backfill once on mount: queue every asset that's missing a
  // thumbnail. The worker pool drains it in the background while the user
  // does whatever they want — including closing the tab. Next visit picks
  // up wherever it left off (any thumbs that already landed in the DB are
  // simply skipped because their thumbnailUrl is now non-null).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (localAssets.length === 0) return;
    autoStartedRef.current = true;
    for (const a of localAssets) {
      if (!a.thumbnailUrl) enqueueAsset(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAssets.length]);

  const filtered = useMemo(() => {
    // Reset to page 1 whenever filters change (side-effectless via key on grid)
    let items = localAssets;

    if (stageFilter !== "all") {
      items = items.filter((a) => a.stage === stageFilter);
    }
    if (nsfwFilter === "sfw") {
      items = items.filter((a) => !a.is_nsfw);
    } else if (nsfwFilter === "nsfw") {
      items = items.filter((a) => a.is_nsfw);
    }
    if (platformFilter === "unposted") {
      items = items.filter((a) => Object.keys(a.platformStatus).length === 0);
    } else if (platformFilter !== "all") {
      items = items.filter((a) => platformFilter in a.platformStatus);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (a) =>
          a.request_title.toLowerCase().includes(q) ||
          a.file_name.toLowerCase().includes(q)
      );
    }

    return items;
  }, [localAssets, stageFilter, nsfwFilter, platformFilter, search]);

  // Reset pagination whenever filters/search change
  const filterKey = `${stageFilter}-${nsfwFilter}-${platformFilter}-${search}`;
  const visibleAssets = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = filtered.length > page * PAGE_SIZE;
  const remaining = filtered.length - page * PAGE_SIZE;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Content Vault</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All uploaded media — playable, downloadable, trackable
          </p>
          {/* Backfill auto-starts on mount and runs in the background.
              We just show progress; nothing to click. */}
          {bf.running && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating thumbnails… {bf.done} done, {bf.queued} queued
            </p>
          )}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          {filtered.length} / {localAssets.length}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by title or filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 pr-9 h-9 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Stage */}
        <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-card p-0.5">
          {STAGE_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStageFilter(s.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                stageFilter === s.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* NSFW */}
        <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-card p-0.5">
          {NSFW_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setNsfwFilter(n)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                nsfwFilter === n
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {n === "all" ? "SFW + NSFW" : n.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Platform */}
        <div className="flex items-center gap-1 overflow-x-auto">
          <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-card p-0.5">
            {PLATFORM_FILTER_OPTIONS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlatformFilter(p.value)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  platformFilter === p.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.value !== "all" && p.value !== "unposted" && (
                  <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT[p.value] ?? "bg-gray-500"}`} />
                )}
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
          <div className="rounded-xl bg-primary/10 p-3">
            <Archive className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No media found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {localAssets.length === 0
              ? "Upload assets to a content request to see them here."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <>
          <div
            key={filterKey}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            {visibleAssets.map((asset) => (
              <VaultCard
                key={asset.id}
                asset={asset}
                onUpdate={handleAssetUpdate}
                onUpdateNsfw={handleNsfwUpdate}
                onVisible={enqueueAsset}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex flex-col items-center gap-1 pt-2">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="rounded-xl border border-border/50 bg-card px-6 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                Load {Math.min(PAGE_SIZE, remaining)} more
                <span className="ml-2 text-xs text-muted-foreground/50">
                  ({remaining} left)
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
