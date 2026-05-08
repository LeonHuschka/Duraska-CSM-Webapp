"use client";

import { useMemo, useState, useRef, useEffect, useTransition } from "react";
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
} from "@/app/(app)/vault/actions";
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
}: {
  asset: VaultAsset;
  onUpdate: (id: string, platformStatus: Record<string, string>) => void;
}) {
  const isVideo = asset.mime_type?.startsWith("video/");
  const isImage = asset.mime_type?.startsWith("image/");

  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Lazy-load: observe when card enters viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" } // start loading 200px before entering view
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const platformEntries = Object.entries(asset.platformStatus);
  const isUnposted = platformEntries.length === 0;

  function handleMediaClick() {
    if (!isVideo || !videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      videoRef.current.play();
      setPlaying(true);
    }
  }

  // Download (or share on mobile). Bypasses the inline-playback issue
  // that browsers do for video/* MIME types when using <a download>.
  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(asset.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], asset.file_name, {
        type: blob.type || asset.mime_type || "application/octet-stream",
      });

      // On mobile, use the Web Share API so the user can pick "Save to Photos",
      // "Save to Files", or share directly. canShare with files is the right
      // signal — it returns false on platforms that can't share files.
      const isTouch =
        typeof navigator !== "undefined" &&
        /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (
        isTouch &&
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({ files: [file], title: asset.file_name });
          return;
        } catch (err) {
          // User cancelled — silently fall through to download.
          if ((err as Error)?.name !== "AbortError") {
            // Non-cancel error → fall through to anchor download below.
          } else {
            return;
          }
        }
      }

      // Desktop / fallback: trigger download via blob URL
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = asset.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Download failed", err);
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
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
        {/* Media — only rendered once visible */}
        {visible && isVideo && (
          <video
            ref={videoRef}
            key={asset.id}
            src={`${asset.signedUrl}#t=0.001`}
            playsInline
            preload="metadata"       // loads first frame as visible thumbnail (~few KB)
            controls={playing}       // show controls only while playing
            onEnded={() => setPlaying(false)}
            className="h-full w-full object-cover"
          />
        )}
        {visible && isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.signedUrl}
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

        {/* Top-left: NSFW/SFW badge + stage */}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
              asset.is_nsfw ? "bg-blue-600/90 text-white" : "bg-green-600/90 text-white"
            }`}
          >
            {asset.is_nsfw ? "NSFW" : "SFW"}
          </span>
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

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-60"
            title="Download"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
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

        {/* Play icon — hover on desktop, always on mobile */}
        {isVideo && visible && !playing && (
          <div className="absolute inset-0 flex items-center justify-center transition-opacity md:opacity-0 md:group-hover:opacity-100 pointer-events-none">
            <div className="rounded-full bg-black/40 p-3 backdrop-blur-sm">
              <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Vault</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All uploaded media — playable, downloadable, trackable
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
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
              <VaultCard key={asset.id} asset={asset} onUpdate={handleAssetUpdate} />
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
