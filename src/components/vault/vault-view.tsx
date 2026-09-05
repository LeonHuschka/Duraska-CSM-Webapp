"use client";

import { useMemo, useState, useRef, useEffect, useTransition, useCallback } from "react";
import { Download, Search, X, Archive, Check, Loader2, Layers, Eye } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TrialBadge } from "@/components/ui/trial-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import type {
  VaultAsset,
  PostingAccount,
  VaultViewer,
  VaultMember,
} from "@/app/(app)/vault/page";

// ─── Platform display config ───────────────────────────────────────────────
const PLATFORM_LABELS: Record<string, string> = {
  fansly: "Fansly",
  instagram: "IG",
  tiktok: "TikTok",
  facebook: "FB",
  x: "X",
  other: "Other",
};

const PLATFORM_DOT: Record<string, string> = {
  fansly: "bg-blue-500",
  instagram: "bg-pink-500",
  tiktok: "bg-slate-400",
  facebook: "bg-blue-600",
  x: "bg-neutral-200",
  other: "bg-gray-500",
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

// ─── Single vault card ──────────────────────────────────────────────────────
// Uses IntersectionObserver so videos/images only load when they enter the viewport.
function VaultCard({
  asset,
  accounts,
  onUpdateNsfw,
  onUpdatePosted,
  onVisible,
}: {
  asset: VaultAsset;
  accounts: PostingAccount[];
  onUpdateNsfw: (requestId: string, isNsfw: boolean) => void;
  onUpdatePosted: (
    assetId: string,
    postedAccountIds: string[],
    /** The reel-level tally to adjust on every card of the same job. */
    change?: { requestId: string; accountId: string; delta: 1 | -1 }
  ) => void;
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

  const postedSet = new Set(asset.postedAccountIds);
  const postedAccounts = accounts.filter((a) => postedSet.has(a.id));
  // Posted on an account the viewer does not manage. Still says "taken" —
  // a cut goes out once, anywhere — without listing whose it was.
  const hiddenPosted = asset.postedAccountIds.length - postedAccounts.length;
  const isUnposted = asset.postedAccountIds.length === 0;

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

  function togglePostedAccount(account: PostingAccount) {
    const isPosted = postedSet.has(account.id);
    startTransition(async () => {
      // Optimistic update. The tick belongs to this cut alone; the reel
      // tally moves on every sibling card too, so they see it straight away.
      const next = isPosted
        ? asset.postedAccountIds.filter((id) => id !== account.id)
        : [...asset.postedAccountIds, account.id];
      const change = {
        requestId: asset.request_id,
        accountId: account.id,
        delta: (isPosted ? -1 : 1) as 1 | -1,
      };
      onUpdatePosted(asset.id, next, change);

      const result = isPosted
        ? await unmarkAssetPostedFromVault({
            asset_id: asset.id,
            request_id: asset.request_id,
            account_id: account.id,
          })
        : await markAssetPostedFromVault({
            asset_id: asset.id,
            request_id: asset.request_id,
            account_id: account.id,
          });

      if (result.error) {
        toast.error(result.error);
        onUpdatePosted(asset.id, asset.postedAccountIds, {
          ...change,
          delta: (change.delta === 1 ? -1 : 1) as 1 | -1,
        }); // revert
      } else {
        toast.success(
          isPosted
            ? `Unmarked @${account.handle}`
            : `Posted on @${account.handle}`
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

        {/* Top-left: NSFW/SFW badge (click to toggle) + stage + optional Trial */}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <div className="flex items-center gap-1">
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
            {asset.is_trial && <TrialBadge size="sm" />}
          </div>
          <div className="flex items-center gap-1">
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/80 capitalize w-fit">
              {asset.stage}
            </span>
            {/* Which cut of the reel this is. Only shown when there are
                siblings — a lone cut has nothing to be confused with. */}
            {asset.variantNo !== null && asset.variantCount > 1 && (
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-bold tabular-nums text-black"
                title={`Cut ${asset.variantNo} of ${asset.variantCount} — ${asset.request_title}`}
              >
                {asset.variantNo}
              </span>
            )}
          </div>
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
              className="w-52 p-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Posted on account
              </div>
              {accounts.length === 0 ? (
                <div className="px-2 py-3 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    No accounts yet.
                  </p>
                  <Link
                    href="/settings/accounts"
                    className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                  >
                    Add accounts →
                  </Link>
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  {accounts.map((acc) => {
                    const isPosted = postedSet.has(acc.id);
                    return (
                      <button
                        key={acc.id}
                        onClick={() => togglePostedAccount(acc)}
                        disabled={pending}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${PLATFORM_DOT[acc.platform] ?? "bg-gray-500"}`}
                          />
                          <span className="truncate">
                            <span className="text-muted-foreground">
                              {PLATFORM_LABELS[acc.platform] ?? acc.platform}
                            </span>{" "}
                            @{acc.handle}
                          </span>
                        </span>
                        {isPosted && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
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

        {/* Bottom gradient + this cut's own posted-account tags. Only the
            accounts the viewer manages are named; a posting on anybody
            else's account shows as a count, because the cut is taken either
            way. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pointer-events-none">
          {isUnposted ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/60">
              Available
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {postedAccounts.map((acc) => (
                <span
                  key={acc.id}
                  className="flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 text-[9px] font-semibold text-white"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT[acc.platform] ?? "bg-gray-400"}`} />
                  @{acc.handle}
                  <span>✓</span>
                </span>
              ))}
              {hiddenPosted > 0 && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-semibold text-white/80">
                  posted elsewhere{hiddenPosted > 1 ? ` (${hiddenPosted})` : ""}
                </span>
              )}
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

// ─── A reel with several cuts ────────────────────────────────────────────────
type Reel = {
  requestId: string;
  title: string;
  /** Cuts matching the current filters — what the grid is showing. */
  cuts: VaultAsset[];
  /** Cuts shown inside the stack: stage and NSFW filters apply, posted state does not. */
  stack: VaultAsset[];
  finalsCount: number;
  freeCount: number;
  cover: VaultAsset;
  /** Postings of any cut, per account. Identical on every cut of the job. */
  postings: VaultAsset["reelPostings"];
};

/**
 * Where the reel has already gone out, written once. Named for the accounts
 * the viewer manages; anything on other people's accounts is folded into a
 * count, because "this reel ran twice somewhere" matters even to somebody
 * who is not allowed to see where.
 */
function ReelTally({
  postings,
  accounts,
  visibleIds,
  size = "sm",
}: {
  postings: Reel["postings"];
  accounts: PostingAccount[];
  visibleIds: Set<string>;
  size?: "sm" | "md";
}) {
  const own = accounts
    .map((acc) => ({ acc, tally: postings[acc.id] }))
    .filter((r): r is { acc: PostingAccount; tally: { count: number; lastAt: string | null } } =>
      Boolean(r.tally && r.tally.count > 0)
    );
  const elsewhere = Object.entries(postings)
    .filter(([id]) => !visibleIds.has(id))
    .reduce((n, [, t]) => n + t.count, 0);
  if (own.length === 0 && elsewhere === 0) return null;
  const text = size === "sm" ? "text-[9px]" : "text-[11px]";
  return (
    <div className="flex flex-wrap gap-1">
      {own.map(({ acc, tally }) => (
        <span
          key={acc.id}
          className={`flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 ${text} font-semibold text-white`}
          title={
            tally.lastAt
              ? `${tally.count}× on @${acc.handle}, last ${new Date(tally.lastAt).toLocaleDateString("de-DE")}`
              : undefined
          }
        >
          <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT[acc.platform] ?? "bg-gray-400"}`} />
          {PLATFORM_LABELS[acc.platform] ?? acc.platform}
          <span className="tabular-nums">({tally.count})</span>
          · {acc.handle}
        </span>
      ))}
      {elsewhere > 0 && (
        <span className={`rounded-full bg-white/20 px-2 py-0.5 ${text} font-semibold text-white/80`}>
          elsewhere ({elsewhere})
        </span>
      )}
    </div>
  );
}

/** One card standing for a whole job. Tap to open its cuts. */
function ReelCard({
  reel,
  accounts,
  visibleIds,
  onOpen,
}: {
  reel: Reel;
  accounts: PostingAccount[];
  visibleIds: Set<string>;
  onOpen: () => void;
}) {
  const c = reel.cover;
  return (
    <div
      className="group overflow-hidden rounded-xl border border-border/50 bg-card transition-colors hover:border-border"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
    >
      <div className="relative aspect-[9/16] w-full cursor-pointer overflow-hidden bg-black">
        {c.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground">
            {reel.title}
          </div>
        )}
        {/* A second, offset frame behind the cover — the card reads as a stack
            before anybody reads the number on it. */}
        <div className="pointer-events-none absolute inset-x-1 -top-1 h-2 rounded-t-lg border border-white/20 bg-white/10" />

        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white ${
              c.is_nsfw ? "bg-blue-600/90" : "bg-green-600/90"
            }`}
          >
            {c.is_nsfw ? "NSFW" : "SFW"}
          </span>
          {c.is_trial && <TrialBadge size="sm" />}
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-black">
          <Layers className="h-3 w-3" />
          <span className="tabular-nums">{reel.finalsCount} cuts</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pointer-events-none">
          <div className="flex flex-wrap gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                reel.freeCount > 0 ? "bg-white/10 text-white/80" : "bg-white/10 text-white/40"
              }`}
            >
              {reel.freeCount} free
            </span>
            <ReelTally postings={reel.postings} accounts={accounts} visibleIds={visibleIds} />
          </div>
        </div>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-xs font-medium leading-tight line-clamp-1 text-foreground">{reel.title}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
          {reel.cuts.length} of {reel.finalsCount} shown · tap to open
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
] as const;

/**
 * One tap for the question a VA opens the Vault with: what can I post now?
 *
 * A reel is posted exactly once, anywhere. Meta sees Instagram and Facebook
 * as one graph, and a re-post measurably underperforms the original — so
 * "still free for the other platform" is not a thing. Posted is posted.
 */
const READY_PRESET = { stage: "edited", nsfw: "sfw", platform: "available" };
const NSFW_OPTIONS = ["all", "sfw", "nsfw"] as const;

const PLATFORM_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "posted", label: "Posted" },
];



export function VaultView({
  assets,
  accounts,
  viewer,
  members,
}: {
  assets: VaultAsset[];
  accounts: PostingAccount[];
  viewer: VaultViewer;
  members: VaultMember[];
}) {
  const [search, setSearch] = useState("");

  // ── Whose accounts are on show ──
  //
  // A VA manages a few accounts and should see those and nothing else: her
  // own ticks, her own tallies, her own picker. Owners and managers see
  // everything, and can borrow a VA's eyes to check what she is getting —
  // which is also the only way to notice that a VA has no accounts at all.
  // The model sees everything too; she never posts, so hiding accounts from
  // her would only produce a warning she cannot act on.
  const canSwitch = viewer.role === "owner" || viewer.role === "manager";
  const [viewAs, setViewAs] = useState<string>("all");
  const lens = canSwitch
    ? viewAs === "all"
      ? null
      : viewAs
    : viewer.role === "model"
      ? null
      : (viewer.username ?? "");
  const norm = (h: string | null | undefined) => (h ?? "").trim().replace(/^@/, "").toLowerCase();
  const visibleAccounts = useMemo(
    () => (lens === null ? accounts : accounts.filter((a) => norm(a.manager_username) === norm(lens))),
    [accounts, lens]
  );
  const visibleIds = useMemo(() => new Set(visibleAccounts.map((a) => a.id)), [visibleAccounts]);
  // A VA with nothing to see: either nobody typed her handle on her profile,
  // or no account names her as manager. Either way, say so instead of
  // showing an empty picker.
  const unassigned = lens !== null && !canSwitch && visibleAccounts.length === 0;
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

  function handlePostedUpdate(
    assetId: string,
    postedAccountIds: string[],
    change?: { requestId: string; accountId: string; delta: 1 | -1 }
  ) {
    // The tick belongs to the single cut — its siblings are separate reels
    // and stay available. The reel tally, though, is shared by every cut of
    // the job, so it moves on all of them.
    setLocalAssets((prev) =>
      prev.map((a) => {
        let next = a.id === assetId ? { ...a, postedAccountIds } : a;
        if (change && a.request_id === change.requestId) {
          const cur = next.reelPostings[change.accountId] ?? { count: 0, lastAt: null };
          const count = Math.max(0, cur.count + change.delta);
          const reelPostings = { ...next.reelPostings };
          if (count === 0) delete reelPostings[change.accountId];
          else
            reelPostings[change.accountId] = {
              count,
              lastAt: change.delta === 1 ? new Date().toISOString() : cur.lastAt,
            };
          next = { ...next, reelPostings };
        }
        return next;
      })
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
    if (platformFilter === "available") {
      items = items.filter((a) => a.postedAccountIds.length === 0);
    } else if (platformFilter === "posted") {
      items = items.filter((a) => a.postedAccountIds.length > 0);
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

  // Carried on the button so the VA sees whether there is anything to do
  // before tapping.
  const readyCount = useMemo(
    () =>
      localAssets.filter(
        (a) => a.stage === "edited" && !a.is_nsfw && a.postedAccountIds.length === 0
      ).length,
    [localAssets]
  );

  // ── One card per reel ──
  //
  // A job yields several finished cuts. They used to sit in the grid as five
  // unrelated cards called "Reel #21", which is how two of them went out on
  // the same day. Now cuts of one job fold into a single card that opens
  // into its stack, and the job's posting record is written once, on that
  // card. A job with a single matching cut stays an ordinary card — most
  // are, and the grid should look the way it always has.
  const cutsByRequest = useMemo(() => {
    const m = new Map<string, VaultAsset[]>();
    for (const a of localAssets) {
      const list = m.get(a.request_id);
      if (list) list.push(a);
      else m.set(a.request_id, [a]);
    }
    return m;
  }, [localAssets]);

  const reels = useMemo<Reel[]>(() => {
    const order: string[] = [];
    const by = new Map<string, VaultAsset[]>();
    for (const a of filtered) {
      const list = by.get(a.request_id);
      if (list) list.push(a);
      else {
        by.set(a.request_id, [a]);
        order.push(a.request_id);
      }
    }
    const byVariant = (x: VaultAsset, y: VaultAsset) =>
      (x.variantNo ?? 999) - (y.variantNo ?? 999);
    return order.map((rid) => {
      const cuts = by.get(rid)!;
      const all = cutsByRequest.get(rid) ?? cuts;
      const finals = all.filter((c) => c.stage === "edited");
      // The stack ignores the posted/available filter on purpose: seeing the
      // posted siblings next to the free ones is the whole point of it.
      const stack = all
        .filter(
          (c) =>
            (stageFilter === "all" || c.stage === stageFilter) &&
            (nsfwFilter === "all" || (nsfwFilter === "nsfw") === c.is_nsfw)
        )
        .sort(byVariant);
      const cover =
        cuts.find((c) => c.thumbnailUrl && c.postedAccountIds.length === 0) ??
        cuts.find((c) => c.thumbnailUrl) ??
        cuts[0];
      return {
        requestId: rid,
        title: cuts[0].request_title,
        cuts,
        stack,
        finalsCount: finals.length,
        freeCount: finals.filter((c) => c.postedAccountIds.length === 0).length,
        cover,
        postings: cuts[0].reelPostings,
      };
    });
  }, [filtered, cutsByRequest, stageFilter, nsfwFilter]);

  const [openReelId, setOpenReelId] = useState<string | null>(null);
  const openReel = openReelId ? reels.find((r) => r.requestId === openReelId) ?? null : null;

  // Reset pagination whenever filters/search change
  const filterKey = `${stageFilter}-${nsfwFilter}-${platformFilter}-${search}`;
  const visibleReels = reels.slice(0, page * PAGE_SIZE);
  const hasMore = reels.length > page * PAGE_SIZE;
  const remaining = reels.length - page * PAGE_SIZE;

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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-sm text-muted-foreground">
            {reels.length} reels · {filtered.length} / {localAssets.length}
          </span>
          {canSwitch && members.length > 0 && (
            <Select value={viewAs} onValueChange={setViewAs}>
              <SelectTrigger className="h-8 w-44 text-xs" title="See the vault as one VA sees it">
                <Eye className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All accounts
                </SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.username} value={m.username} className="text-xs">
                    @{m.username} · {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {unassigned && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          No posting account is assigned to you yet. Ask your manager to enter
          your Telegram username under Settings → Personas and to name you as
          manager on your accounts.
        </div>
      )}
      {canSwitch && lens !== null && visibleAccounts.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          @{lens} manages no account yet — this is exactly what they see.
        </div>
      )}

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

      {/* One-tap presets, each carrying the count so the VA can see at a
          glance whether there is anything to do for that platform. */}
      {(() => {
        const active =
          stageFilter === READY_PRESET.stage &&
          nsfwFilter === READY_PRESET.nsfw &&
          platformFilter === READY_PRESET.platform;
        return (
          <button
            onClick={() => {
              if (active) {
                setStageFilter("all");
                setNsfwFilter("all");
                setPlatformFilter("all");
                return;
              }
              setStageFilter(READY_PRESET.stage);
              setNsfwFilter(READY_PRESET.nsfw);
              setPlatformFilter(READY_PRESET.platform);
            }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/50 bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Ready to post
            <span className="tabular-nums text-muted-foreground">
              {readyCount}
            </span>
          </button>
        );
      })()}

      {/* Filters — tap-friendly dropdowns (no horizontal dragging on mobile) */}
      <div className="grid grid-cols-3 gap-2">
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={nsfwFilter} onValueChange={setNsfwFilter}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NSFW_OPTIONS.map((n) => (
              <SelectItem key={n} value={n} className="text-xs">
                {n === "all" ? "SFW + NSFW" : n.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_FILTER_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            {visibleReels.map((reel) =>
              reel.cuts.length === 1 ? (
                <VaultCard
                  key={reel.cuts[0].id}
                  asset={reel.cuts[0]}
                  accounts={visibleAccounts}
                  onUpdateNsfw={handleNsfwUpdate}
                  onUpdatePosted={handlePostedUpdate}
                  onVisible={enqueueAsset}
                />
              ) : (
                <ReelCard
                  key={reel.requestId}
                  reel={reel}
                  accounts={visibleAccounts}
                  visibleIds={visibleIds}
                  onOpen={() => setOpenReelId(reel.requestId)}
                />
              )
            )}
          </div>

          <Dialog open={openReel !== null} onOpenChange={(o) => !o && setOpenReelId(null)}>
            <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
              {openReel && (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                      {openReel.title}
                      <span className="text-sm font-normal text-muted-foreground">
                        {openReel.finalsCount} cuts · {openReel.freeCount} free
                      </span>
                    </DialogTitle>
                    <DialogDescription asChild>
                      <div className="pt-1">
                        <ReelTally
                          postings={openReel.postings}
                          accounts={visibleAccounts}
                          visibleIds={visibleIds}
                          size="md"
                        />
                      </div>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {openReel.stack.map((asset) => (
                      <VaultCard
                        key={asset.id}
                        asset={asset}
                        accounts={visibleAccounts}
                        onUpdateNsfw={handleNsfwUpdate}
                        onUpdatePosted={handlePostedUpdate}
                        onVisible={enqueueAsset}
                      />
                    ))}
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>

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
