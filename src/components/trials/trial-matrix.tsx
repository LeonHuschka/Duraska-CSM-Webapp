"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRightLeft, ArrowUpRight, Check, Eye, Film, Loader2, Minus, Play, Plus, Send, Trash2, Trophy, Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { generateThumbnail, generateThumbnailFromUrl, safeStorageName } from "@/lib/thumbnails";
import { isMediaFile, MAX_UPLOAD_MB, resolveMime, uploadToStorage } from "@/lib/upload-takes";
import { AccountAvatar } from "@/components/pipeline/account-avatar";
import { TakeGrid, type GridTake } from "@/components/upload/take-grid";
import { setAssetFansly } from "@/app/(app)/requests/[id]/actions";
import {
  addCell,
  advanceTrial,
  archiveTrial,
  moveCell,
  removeCell,
  reorderCell,
  requestCell,
  setDefaultReshoots,
  setTrialNickname,
  fetchOutlierVideo,
  finishCell,
  openCellJob,
  recordTake,
  setCellLabel,
  setCellText,
  setCellThumb,
  toggleWinner,
} from "@/app/(app)/trials/actions";

type Dimension = "outfit" | "location" | "hook";
type Phase = Dimension | "done";
type CellState = "empty" | "takes" | "finished" | "edited" | "posted";
export type MatrixCell = {
  id: string;
  dimension: Dimension;
  slot: number;
  label: string | null;
  requestId: string | null;
  title: string | null;
  takes: number;
  cuts: number;
  state: CellState;
  thumb: string | null;
  views: number | null;
  postedAt: string | null;
  winner: boolean;
  firstTake: { url: string; mime: string | null } | null;
  video: { url: string; cut: boolean } | null;
  plays: { accountId: string; label: string; avatar: string | null; platform: string; views: number; url: string | null }[];
  brief: string | null;
  notes: string | null;
  requestedAt: string | null;
};
export type MatrixTrial = {
  id: string;
  personaId: string;
  account: { label: string; platform: string; avatar: string | null; median: number | null } | null;
  postUrl: string | null;
  caption: string | null;
  nickname: string | null;
  cover: string | null;
  video: string | null;
  views: number | null;
  lift: number | null;
  sourceTitle: string | null;
  phase: Phase;
  status: string;
  /** Reshoots per round. */
  reshoots: number;
  cells: MatrixCell[];
  briefs: Record<Dimension, string>;
};

const DIMS: Dimension[] = ["outfit", "location", "hook"];
const META: Record<Dimension, { title: string; one: string; emoji: string }> = {
  outfit: { title: "Outfits", one: "Outfit", emoji: "👗" },
  location: { title: "Locations", one: "Location", emoji: "📍" },
  hook: { title: "Hooks", one: "Hook", emoji: "🪝" },
};
const nf = new Intl.NumberFormat("de-DE");
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : nf.format(n);
const name = (c: Pick<MatrixCell, "dimension" | "slot" | "label">) => c.label?.trim() || `${META[c.dimension].one} ${c.slot}`;
const phaseIdx = (p: Phase) => (p === "done" ? 3 : DIMS.indexOf(p));
const doneCount = (row: MatrixCell[]) => row.filter((c) => c.state !== "empty" && c.state !== "takes").length;
const totalPlays = (c: MatrixCell) => c.plays.reduce((a, p) => a + p.views, 0);

const DRAG_TYPE = "application/x-trial-cell";
const MAX_PER_ROUND = 12;

const STATE_CHIP: Record<CellState, { label: string; cls: string }> = {
  empty: { label: "To shoot", cls: "bg-black/60 text-white/80" },
  takes: { label: "Takes in", cls: "bg-sky-500/90 text-white" },
  finished: { label: "With editor", cls: "bg-violet-500/90 text-white" },
  edited: { label: "Cut", cls: "bg-indigo-500/90 text-white" },
  posted: { label: "Posted", cls: "bg-emerald-500 text-white" },
};

/**
 * The trial as a work board: the outlier and its numbers on top, then a
 * round per row — outfits, locations, hooks — with every variation as a
 * reel to play, its plays on each account, what the model is to do in it
 * and the team's notes. The team picks each round's winner by hand; the
 * round is decided only once one is picked.
 */
export function TrialMatrix({
  trial,
  staff,
  backHref,
  preview = false,
}: {
  trial: MatrixTrial;
  staff: boolean;
  backHref: string;
  /** A manager looking at the page as the model sees it. */
  preview?: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = trial.cells.find((c) => c.id === openId) ?? null;
  const pIdx = phaseIdx(trial.phase);
  const rows = DIMS.map((d) => trial.cells.filter((c) => c.dimension === d).sort((a, b) => a.slot - b.slot));
  const winners = (d: Dimension) => trial.cells.filter((c) => c.dimension === d && c.winner).map(name);

  const refresh = useCallback(() => router.refresh(), [router]);
  useMissingPictures(trial, refresh);

  // The outlier's video, fetched once for a trial that has none yet.
  const asked = useRef(false);
  useEffect(() => {
    if (trial.video || asked.current || !trial.postUrl) return;
    asked.current = true;
    fetchOutlierVideo(trial.id).then((r) => r.ok && router.refresh());
  }, [trial.video, trial.id, trial.postUrl, router]);

  if (!staff) {
    return (
      <>
        <ModelTrial trial={trial} backHref={backHref} preview={preview} onOpen={setOpenId} />
        <CellSheet cell={open} trial={trial} staff={false} onClose={() => setOpenId(null)} onChanged={refresh} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <div className="flex items-center gap-4">
          <Link href={`/trials/${trial.id}?view=model`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Eye className="h-3.5 w-3.5" /> As the model sees it
          </Link>
          {trial.account && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <AccountAvatar src={trial.account.avatar} platform={trial.account.platform} label={trial.account.label} size={20} />
              {trial.account.label}
            </span>
          )}
        </div>
      </div>

      <Header trial={trial} winners={winners} staff={staff} onChanged={refresh} />

      {DIMS.map((d, i) => (
        <Round
          key={d}
          d={d}
          index={i}
          row={rows[i]}
          state={i < pIdx ? "decided" : i === pIdx ? "now" : "later"}
          brief={trial.briefs[d]}
          winners={winners(d)}
          trial={trial}
          staff={staff}
          onOpen={setOpenId}
          onChanged={refresh}
        />
      ))}

      {staff && trial.status === "active" && (
        <div className="text-center">
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-rose-400"
            onClick={async () => {
              if (!confirm("Stop this trial? The jobs already made stay where they are.")) return;
              const r = await archiveTrial(trial.id);
              if (r.error) toast.error(r.error);
              router.refresh();
            }}
          >
            Stop this trial
          </button>
        </div>
      )}

      <CellSheet cell={open} trial={trial} staff={staff} onClose={() => setOpenId(null)} onChanged={refresh} />
    </div>
  );
}

/** Draw a cell's picture from its first take when uploading could not. */
function useMissingPictures(trial: MatrixTrial, refresh: () => void) {
  const drawing = useRef(new Set<string>());
  useEffect(() => {
    const todo = trial.cells.filter((c) => !c.thumb && c.firstTake && !drawing.current.has(c.id));
    if (todo.length === 0) return;
    let cancelled = false;
    // Browsers decode no video frames in a hidden tab; wait until she looks.
    const run = async () => {
      const supabase = createClient();
      let any = false;
      for (const c of todo) {
        drawing.current.add(c.id);
        try {
          const blob = await generateThumbnailFromUrl(c.firstTake!.url, c.firstTake!.mime);
          if (!blob || cancelled) continue;
          const tp = `personas/${trial.personaId}/trials/${trial.id}/${c.id}.jpg`;
          const { error } = await supabase.storage.from("content-assets").upload(tp, blob, { contentType: "image/jpeg", upsert: true });
          if (!error) {
            await setCellThumb(c.id, tp);
            any = true;
          }
        } catch {}
      }
      if (any && !cancelled) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      run();
    };
    if (document.visibilityState === "visible") run();
    else document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [trial.cells, trial.id, trial.personaId, refresh]);
}

/** A reel in 9:16: its picture, and the video in place once played. */
function ReelPlayer({
  video,
  poster,
  className = "",
  onEmpty,
  children,
}: {
  video: string | null;
  poster: string | null;
  className?: string;
  onEmpty?: () => void;
  children?: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-muted ${className}`}>
      {playing && video ? (
        <video src={video} poster={poster ?? undefined} autoPlay controls playsInline className="h-full w-full bg-black object-cover" />
      ) : (
        <button
          type="button"
          onClick={() => (video ? setPlaying(true) : onEmpty?.())}
          className="group block h-full w-full"
          title={video ? "Play" : undefined}
        >
          {poster && <img src={poster} alt="" className="h-full w-full object-cover" />}
          {!poster && video && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Film className="h-6 w-6 text-muted-foreground" />
            </span>
          )}
          {video && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm transition-transform group-hover:scale-105 group-active:scale-95">
                <Play className="h-5 w-5 fill-white text-white" />
              </span>
            </span>
          )}
        </button>
      )}
      {!playing && children}
    </div>
  );
}

/** The name she knows the reel by — in SHOOTING in place of the account. */
function NicknameField({ trial, onChanged }: { trial: MatrixTrial; onChanged: () => void }) {
  const [v, setV] = useState(trial.nickname ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => setV(trial.nickname ?? ""), [trial.nickname]);
  const save = async () => {
    if (v.trim() === (trial.nickname ?? "")) return;
    setState("saving");
    const r = await setTrialNickname(trial.id, v);
    if (r.error) {
      setState("idle");
      return void toast.error(r.error);
    }
    setState("saved");
    setTimeout(() => setState("idle"), 1500);
    onChanged();
  };
  return (
    <label className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Name for her</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        maxLength={40}
        placeholder='e.g. "towel door" — shown in SHOOTING instead of the account'
        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/60"
      />
      {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {state === "saved" && <Check className="h-3.5 w-3.5 text-emerald-400" />}
    </label>
  );
}

/** The outlier, the bar to beat, and where the trial stands. */
function Header({
  trial,
  winners,
  staff,
  onChanged,
}: {
  trial: MatrixTrial;
  winners: (d: Dimension) => string[];
  staff: boolean;
  onChanged: () => void;
}) {
  const pIdx = phaseIdx(trial.phase);
  const median = trial.account?.median ?? null;
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border/50 bg-card p-4 sm:flex-row">
      <div className="w-36 shrink-0 self-center sm:self-start">
        <ReelPlayer video={trial.video} poster={trial.cover} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Outlier · the reel to reshoot</p>
            <p className="text-3xl font-semibold tabular-nums">{trial.views != null ? nf.format(trial.views) : "—"}</p>
            <p className="text-[11px] text-muted-foreground">
              plays{trial.lift ? ` · ${trial.lift.toFixed(0)}× the usual` : ""}
            </p>
          </div>
          {median != null && (
            <div>
              <p className="text-[11px] text-muted-foreground">Usual on {trial.account?.label}</p>
              <p className="text-xl font-semibold tabular-nums">{nf.format(median)}</p>
              <p className="text-[11px] text-muted-foreground">plays a reel</p>
            </div>
          )}
          {trial.postUrl && (
            <a
              href={trial.postUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 pb-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Open on {trial.account?.platform === "facebook" ? "Facebook" : "Instagram"} <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
        </div>
        {staff && <NicknameField trial={trial} onChanged={onChanged} />}
        {trial.caption && <p className="line-clamp-2 text-xs text-muted-foreground">{trial.caption}</p>}

        {/* Where it stands: one step per round, the winners as they are picked. */}
        <div className="grid grid-cols-3 gap-2">
          {DIMS.map((d, i) => {
            const w = winners(d);
            const state = i < pIdx ? "decided" : i === pIdx ? "now" : "later";
            return (
              <div
                key={d}
                className={`rounded-xl border px-3 py-2 ${
                  state === "now" ? "border-primary/60 bg-primary/10" : state === "decided" ? "border-amber-400/40 bg-amber-400/5" : "border-border/50"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Round {i + 1} · {state === "decided" ? "decided" : state === "now" ? "now" : "next"}
                </p>
                <p className="mt-0.5 truncate text-sm font-medium">
                  {META[d].emoji} {w.length ? w.join(", ") : META[d].title}
                </p>
              </div>
            );
          })}
        </div>
        <Overview trial={trial} />
        {trial.phase === "done" && (
          <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            Pattern found: {DIMS.map((d) => winners(d).join(" / ") || "—").join(" · ")}
          </p>
        )}
        {staff && <ReshootCount value={trial.reshoots} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function Round({
  d,
  index,
  row,
  state,
  brief,
  winners,
  trial,
  staff,
  onOpen,
  onChanged,
}: {
  d: Dimension;
  index: number;
  row: MatrixCell[];
  state: "decided" | "now" | "later";
  brief: string;
  winners: string[];
  trial: MatrixTrial;
  staff: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const shot = doneCount(row);
  const posted = row.filter((c) => c.state === "posted").length;
  const [over, setOver] = useState(false);
  const [adding, startAdd] = useTransition();
  // Rank by plays across all accounts — the numbers to decide on.
  const ranked = row.filter((c) => c.plays.length).sort((a, b) => totalPlays(b) - totalPlays(a));
  const rank = new Map(ranked.map((c, i) => [c.id, i + 1]));
  const best = ranked[0] ? totalPlays(ranked[0]) : 0;
  return (
    <section
      onDragOver={(e) => {
        if (!staff || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (e) => {
        setOver(false);
        const [id, from] = (e.dataTransfer.getData(DRAG_TYPE) || "").split("|");
        if (!id || from === d) return;
        e.preventDefault();
        const r = await moveCell(id, d);
        if (r.error) toast.error(r.error);
        else toast.success(`Moved to ${META[d].title}`);
        onChanged();
      }}
      className={`rounded-2xl border bg-card p-4 transition-colors ${
        over ? "border-primary bg-primary/5" : state === "now" ? "border-primary/40" : "border-border/50"
      } ${state === "later" ? "opacity-90" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Round {index + 1}
            {state === "now" ? " · now" : state === "decided" ? " · decided" : ""}
          </p>
          <h2 className="text-base font-semibold">
            {META[d].emoji} {row.length} {META[d].title}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {shot} of {row.length} shot · {posted} posted
            {winners.length > 0 && <span className="text-amber-300"> · winner: {winners.join(", ")}</span>}
          </p>
        </div>
        {staff && state === "now" && <DecideButton trialId={trial.id} index={index} row={row} />}
      </div>
      {state !== "decided" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{brief}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {row.map((c, i) => (
          <VariantCard
            key={c.id}
            c={c}
            prev={row[i - 1]?.id ?? null}
            next={row[i + 1]?.id ?? null}
            rank={rank.get(c.id) ?? null}
            best={best}
            outlier={trial.views}
            staff={staff}
            onOpen={() => onOpen(c.id)}
            onChanged={onChanged}
          />
        ))}
        {staff && row.length < MAX_PER_ROUND && (
          <div className="p-1.5">
            <button
              type="button"
              disabled={adding}
              onClick={() =>
                startAdd(async () => {
                  const r = await addCell(trial.id, d);
                  if (r.error) toast.error(r.error);
                  onChanged();
                })
              }
              className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              {adding ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-6 w-6" />}
              <span className="text-[11px]">Add {META[d].one.toLowerCase()}</span>
            </button>
          </div>
        )}
      </div>
      {staff && row.length > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">Drag a reel onto another round to move it there.</p>
      )}
    </section>
  );
}

/** One variation: the reel, its plays per account, the brief for her, the team's notes. */
function VariantCard({
  c,
  prev,
  next,
  rank,
  best,
  outlier,
  staff,
  onOpen,
  onChanged,
}: {
  c: MatrixCell;
  prev: string | null;
  next: string | null;
  rank: number | null;
  best: number;
  outlier: number | null;
  staff: boolean;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, start] = useTransition();
  const [over, setOver] = useState(false);
  const total = totalPlays(c);
  const chip = STATE_CHIP[c.state];
  const stateLine =
    c.state === "empty"
      ? "Nothing shot yet"
      : c.state === "takes"
        ? `${c.takes} take${c.takes === 1 ? "" : "s"} in`
        : c.state === "finished"
          ? `With the editor · ${c.takes} takes`
          : c.state === "edited"
            ? "Cut — waiting to be posted"
            : "Posted";
  return (
    <div
      onDragOver={(e) => {
        // A reel of the same round dropped here takes this place.
        if (!staff || !e.dataTransfer.types.includes(`${DRAG_TYPE}-${c.dimension}`)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (e) => {
        const [id, from] = (e.dataTransfer.getData(DRAG_TYPE) || "").split("|");
        setOver(false);
        if (!id || from !== c.dimension) return;
        e.preventDefault();
        e.stopPropagation();
        if (id === c.id) return;
        const r = await reorderCell(id, c.id);
        if (r.error) toast.error(r.error);
        onChanged();
      }}
      className={`flex min-w-0 flex-col gap-2 rounded-xl p-1.5 transition-shadow ${c.winner ? "bg-amber-400/10 ring-2 ring-amber-400" : ""} ${
        over ? "ring-2 ring-primary" : ""
      }`}
    >
      <div
        draggable={staff}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, `${c.id}|${c.dimension}`);
          // Its round in the type too: drag-over can read types, not data.
          e.dataTransfer.setData(`${DRAG_TYPE}-${c.dimension}`, "1");
          e.dataTransfer.effectAllowed = "move";
        }}
        className={staff ? "cursor-grab active:cursor-grabbing" : ""}
      >
      <ReelPlayer video={c.video?.url ?? null} poster={c.thumb} onEmpty={onOpen} className={c.state === "empty" ? "border border-dashed border-border bg-muted/20" : ""}>
        {c.state === "empty" && (
          <button type="button" onClick={onOpen} className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
            <Plus className="h-5 w-5" />
            <span className="text-[11px]">Upload takes</span>
          </button>
        )}
        <span className={`pointer-events-none absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
        {c.winner ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-black">
            <Trophy className="h-3 w-3" /> Winner
          </span>
        ) : rank ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">#{rank}</span>
        ) : null}
        {c.requestedAt && (c.state === "empty" || c.state === "takes") && (
          <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-full bg-sky-500/90 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
            📲 In SHOOTING
          </span>
        )}
        {c.video && !c.video.cut && !c.requestedAt && (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1 text-[9px] text-white/80">raw take</span>
        )}
      </ReelPlayer>
      </div>

      {staff ? (
        <div className="flex min-w-0 items-center gap-1">
          <NameField c={c} onChanged={onChanged} />
          <MoveMenu c={c} prev={prev} next={next} onChanged={onChanged} />
        </div>
      ) : (
        <p className="truncate text-sm font-medium">{name(c)}</p>
      )}
      <p className="-mt-1.5 text-[10px] text-muted-foreground">{stateLine}</p>

      {/* Plays on every account it went out on. */}
      <div className="rounded-lg bg-muted/40 p-2">
        {c.plays.length ? (
          <>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-base font-semibold tabular-nums">{nf.format(total)}</span>
              <span className="text-[10px] text-muted-foreground">
                {outlier ? `${Math.round((total / outlier) * 100)}% of outlier` : "plays"}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${c.winner ? "bg-amber-400" : "bg-foreground/50"}`} style={{ width: `${best ? (total / best) * 100 : 0}%` }} />
            </div>
            <div className="mt-1.5 space-y-1">
              {c.plays.map((p) => (
                <a
                  key={p.accountId}
                  href={p.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[11px] hover:text-foreground"
                >
                  <AccountAvatar src={p.avatar} platform={p.platform} label={p.label} size={14} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.label}</span>
                  <span className="tabular-nums">{short(p.views)}</span>
                </a>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">No plays yet — not posted</p>
        )}
      </div>

      {staff ? (
        <BriefField c={c} onChanged={onChanged} />
      ) : (
        c.brief && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary">What to do</p>
            <p className="whitespace-pre-line text-xs">{c.brief}</p>
          </div>
        )
      )}
      {staff && (
        <TextNote value={c.notes} placeholder="Your notes on this one…" label="My notes" onSave={(t) => setCellText(c.id, "notes", t)} onSaved={onChanged} />
      )}

      <div className="mt-auto flex gap-1.5">
        {staff && (
          <Button
            size="sm"
            variant={c.winner ? "default" : "outline"}
            disabled={busy}
            className={`h-8 min-w-0 flex-1 px-1.5 text-[11px] ${c.winner ? "bg-amber-400 text-black hover:bg-amber-300" : ""}`}
            onClick={() =>
              start(async () => {
                const r = await toggleWinner(c.id);
                if (r.error) toast.error(r.error);
                onChanged();
              })
            }
          >
            <Trophy className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{c.winner ? "Winner" : "Pick"}</span>
          </Button>
        )}
        {staff && <RequestButton c={c} onChanged={onChanged} />}
        <Button size="sm" variant="outline" className="h-8 shrink-0 px-2 text-[11px]" onClick={onOpen} title="Upload takes">
          <Upload className="h-3.5 w-3.5" />
          {!staff && <span className="ml-1">Takes</span>}
        </Button>
      </div>
    </div>
  );
}

/** Into her SHOOTING message — brief and upload button — or out of it again. */
function RequestButton({ c, onChanged }: { c: MatrixCell; onChanged: () => void }) {
  const [busy, start] = useTransition();
  const on = !!c.requestedAt;
  const done = c.state !== "empty" && c.state !== "takes";
  if (done) return null;
  return (
    <Button
      size="sm"
      variant={on ? "default" : "outline"}
      disabled={busy}
      className={`h-8 shrink-0 px-2 ${on ? "bg-sky-500 text-white hover:bg-sky-400" : ""}`}
      title={on ? "In her SHOOTING message — click to take it out" : c.brief ? "Send to her SHOOTING message, with the brief" : "Write what she does first, then send"}
      onClick={() =>
        start(async () => {
          if (!on && !c.brief?.trim()) return void toast.error("Write what she does in this one first");
          const r = await requestCell(c.id, !on);
          if (r.error) toast.error(r.error);
          else toast.success(on ? "Taken out of SHOOTING" : "Sent to SHOOTING 📲");
          onChanged();
        })
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** Into another round, or out of this one while it is still empty. */
function MoveMenu({ c, prev, next, onChanged }: { c: MatrixCell; prev: string | null; next: string | null; onChanged: () => void }) {
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else toast.success(ok);
      onChanged();
    });
  const empty = c.state === "empty" && !c.requestId && !c.winner;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0 text-muted-foreground" disabled={busy} title="Move or remove">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!prev} onClick={() => prev && run(() => reorderCell(c.id, prev), "Moved left")}>
          ← Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!next} onClick={() => next && run(() => reorderCell(c.id, next), "Moved right")}>
          → Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {DIMS.filter((d) => d !== c.dimension).map((d) => (
          <DropdownMenuItem key={d} onClick={() => run(() => moveCell(c.id, d), `Moved to ${META[d].title}`)}>
            {META[d].emoji} Move to {META[d].title}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!empty}
          className="text-rose-400"
          onClick={() => run(() => removeCell(c.id), `${name(c)} removed`)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {empty ? "Remove" : "Remove (has takes — move it instead)"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The brief on the card as she will read it; a click opens the editor. */
function BriefField({ c, onChanged }: { c: MatrixCell; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5 text-left transition-colors hover:border-primary/60"
      >
        <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-primary">
          For the model
          {c.requestedAt && <span className="normal-case text-sky-300">📲 in SHOOTING</span>}
        </span>
        {c.brief?.trim() ? (
          <span className="mt-0.5 line-clamp-5 block whitespace-pre-line text-xs leading-snug">{c.brief}</span>
        ) : (
          <span className="mt-0.5 block text-xs text-muted-foreground/70">+ Write what she does…</span>
        )}
      </button>
      {open && <BriefEditor c={c} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

const BULLET = "• ";

/**
 * The brief, written big: a list by default — Enter starts the next point,
 * Enter on an empty point ends the list. Saved, or saved and sent to her
 * SHOOTING message in one go.
 */
function BriefEditor({ c, onClose, onChanged }: { c: MatrixCell; onClose: () => void; onChanged: () => void }) {
  const [v, setV] = useState(c.brief?.trim() ? c.brief : BULLET);
  const [busy, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !c.requestedAt && (c.state === "empty" || c.state === "takes");
  const clean = (t: string) =>
    t
      .split("\n")
      .filter((l) => l.trim() !== "•" && l.trim() !== "")
      .join("\n")
      .trim();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = (send: boolean) =>
    start(async () => {
      const text = clean(v);
      const r = await setCellText(c.id, "brief", text);
      if (r.error) return void toast.error(r.error);
      if (send) {
        if (!text) return void toast.error("Write what she does first");
        const q = await requestCell(c.id, true);
        if (q.error) toast.error(q.error);
        else toast.success("Saved and sent to SHOOTING 📲");
      } else toast.success("Saved");
      onChanged();
      onClose();
    });

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      return save(false);
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.currentTarget;
    const at = el.selectionStart;
    const lineStart = v.lastIndexOf("\n", at - 1) + 1;
    const line = v.slice(lineStart, at);
    if (!line.startsWith(BULLET) && line.trim() !== "•") return;
    e.preventDefault();
    if (line.trim() === "•") {
      // An empty point: the list ends here.
      const next = v.slice(0, lineStart) + v.slice(at);
      setV(next);
      requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
      return;
    }
    const next = `${v.slice(0, at)}\n${BULLET}${v.slice(el.selectionEnd)}`;
    setV(next);
    const pos = at + 1 + BULLET.length;
    requestAnimationFrame(() => el.setSelectionRange(pos, pos));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {META[c.dimension].emoji} {name(c)} — for the model
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          One point per line — Enter starts the next, Enter on an empty point ends the list. She sees it on her page, on the upload and in SHOOTING.
        </p>
        <textarea
          ref={ref}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={onKey}
          rows={10}
          placeholder="• Black dress, hair up&#10;• Start at the door, look back&#10;• Text on screen: …"
          className="w-full resize-y rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[10px] text-muted-foreground">⌘ Enter saves</span>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {canSend && (
            <Button size="sm" onClick={() => save(true)} disabled={busy} className="bg-sky-500 text-white hover:bg-sky-400">
              <Send className="mr-1.5 h-3.5 w-3.5" /> Save &amp; send to SHOOTING
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The variation's name, edited in place. */
function NameField({ c, onChanged }: { c: MatrixCell; onChanged: () => void }) {
  const [v, setV] = useState(c.label ?? "");
  useEffect(() => setV(c.label ?? ""), [c.label]);
  const save = async () => {
    if (v.trim() === (c.label ?? "")) return;
    const r = await setCellLabel(c.id, v);
    if (r.error) toast.error(r.error);
    else onChanged();
  };
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder={`${META[c.dimension].one} ${c.slot} — name it`}
      className="min-w-0 flex-1 truncate rounded bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/70 hover:bg-muted/40 focus:bg-muted/60 focus:px-1"
    />
  );
}

/** A text that saves itself when you leave the field. */
function TextNote({
  value,
  placeholder,
  label,
  onSave,
  onSaved,
  tone,
}: {
  value: string | null;
  placeholder: string;
  label: string;
  onSave: (t: string) => Promise<{ error: string | null }>;
  onSaved: () => void;
  tone?: "brief";
}) {
  const [v, setV] = useState(value ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => setV(value ?? ""), [value]);
  const save = async () => {
    if (v.trim() === (value ?? "").trim()) return;
    setState("saving");
    const r = await onSave(v);
    if (r.error) {
      setState("idle");
      return void toast.error(r.error);
    }
    setState("saved");
    setTimeout(() => setState("idle"), 1500);
    onSaved();
  };
  return (
    <label className="block">
      <span className={`flex items-center justify-between text-[10px] font-medium uppercase tracking-wide ${tone === "brief" ? "text-primary" : "text-muted-foreground"}`}>
        {label}
        {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
        {state === "saved" && <Check className="h-3 w-3 text-emerald-400" />}
      </span>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder={placeholder}
        className={`mt-0.5 w-full resize-y rounded-lg border px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring ${
          tone === "brief" ? "border-primary/30 bg-primary/5" : "border-border/50 bg-muted/30"
        }`}
      />
    </label>
  );
}

function DecideButton({ trialId, index, row }: { trialId: string; index: number; row: MatrixCell[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const picked = row.filter((c) => c.winner).length;
  const next = DIMS[index + 1];
  return (
    <Button
      size="sm"
      disabled={busy || picked === 0}
      title={picked === 0 ? "Make one of them the winner first" : undefined}
      className="h-8"
      onClick={() =>
        start(async () => {
          const r = await advanceTrial(trialId);
          if (r.error) toast.error(r.error);
          else toast.success(next ? `${META[next].title} are open` : "Pattern found");
          router.refresh();
        })
      }
    >
      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trophy className="mr-1.5 h-3.5 w-3.5" />}
      {picked === 0 ? "Pick a winner to decide" : next ? `Decide · open ${META[next].title.toLowerCase()}` : "Decide · pattern found"}
    </Button>
  );
}

/** Where the reshoots stand in numbers: the best one, how far they went out, how much is shot. */
function overviewOf(trial: MatrixTrial) {
  const withPlays = trial.cells.filter((c) => c.plays.length);
  const best = withPlays.sort((a, b) => totalPlays(b) - totalPlays(a))[0] ?? null;
  const accounts = new Set(trial.cells.flatMap((c) => c.plays.map((p) => p.accountId)));
  const shot = trial.cells.filter((c) => c.state !== "empty" && c.state !== "takes").length;
  const posted = trial.cells.filter((c) => c.state === "posted").length;
  return { best, accounts: accounts.size, shot, posted, total: trial.cells.length };
}

function Overview({ trial, compact = false }: { trial: MatrixTrial; compact?: boolean }) {
  const o = overviewOf(trial);
  const items = [
    {
      k: "Best reshoot",
      v: o.best ? short(totalPlays(o.best)) : "—",
      sub: o.best ? `${name(o.best)}${o.best.plays[0] ? ` · ${o.best.plays[0].label}` : ""}` : "nothing posted yet",
    },
    { k: "Posted on", v: String(o.accounts), sub: o.accounts === 1 ? "account" : "accounts" },
    { k: "Shot", v: `${o.shot}/${o.total}`, sub: `${o.posted} posted` },
  ];
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-3"}`}>
      {items.map((it) => (
        <div key={it.k} className="rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.k}</p>
          <p className="text-lg font-semibold tabular-nums leading-tight">{it.v}</p>
          <p className="truncate text-[10px] text-muted-foreground">{it.sub}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The model's page, for the phone: the outlier and the numbers side by
 * side, then what she is asked to shoot — each with its brief, one tap to
 * upload — and the rounds as small reels with their plays.
 */
function ModelTrial({
  trial,
  backHref,
  preview,
  onOpen,
}: {
  trial: MatrixTrial;
  backHref: string;
  preview: boolean;
  onOpen: (id: string) => void;
}) {
  const pIdx = phaseIdx(trial.phase);
  const open = (c: MatrixCell) => c.state === "empty" || c.state === "takes";
  const asked = trial.cells
    .filter((c) => c.requestedAt && open(c))
    .sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
  // Nothing asked for by name: the open boxes of the round she is in.
  const current = trial.phase === "done" ? [] : trial.cells.filter((c) => c.dimension === trial.phase && open(c)).sort((a, b) => a.slot - b.slot);
  const jobs = asked.length ? asked : current;
  return (
    <div className="mx-auto max-w-md space-y-4 pb-16">
      {preview && (
        <div className="flex items-center justify-between rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          <span>
            <Eye className="mr-1 inline h-3.5 w-3.5" /> This is what the model sees
          </span>
          <Link href={`/trials/${trial.id}`} className="font-medium underline underline-offset-2">
            Back to yours
          </Link>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        {trial.account && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <AccountAvatar src={trial.account.avatar} platform={trial.account.platform} label={trial.account.label} size={18} />
            {trial.account.label}
          </span>
        )}
      </div>

      {trial.nickname && <h1 className="px-1 text-xl font-semibold">🧪 {trial.nickname}</h1>}
      {/* Left the reel she reshoots, right where the reshoots stand. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-2">
          <ReelPlayer video={trial.video} poster={trial.cover} />
          <p className="mt-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">Outlier</p>
          <p className="px-1 text-xl font-semibold tabular-nums leading-tight">{trial.views != null ? short(trial.views) : "—"}</p>
          <p className="px-1 text-[10px] text-muted-foreground">plays{trial.lift ? ` · ${trial.lift.toFixed(0)}× usual` : ""}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-card p-2">
          <Overview trial={trial} compact />
          <p className="mt-auto px-1 text-[10px] text-muted-foreground">
            Round {Math.min(pIdx + 1, 3)} of 3{trial.phase !== "done" ? ` · ${META[trial.phase].title}` : " · done"}
          </p>
        </div>
      </div>

      {/* What to shoot now: clear enough to read at a glance. */}
      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">{asked.length ? "👉 Shoot these" : trial.phase === "done" ? "All done 🏁" : "👉 Shoot next"}</h2>
        {jobs.length === 0 && trial.phase !== "done" && (
          <p className="rounded-2xl border border-dashed border-border/50 px-4 py-5 text-center text-xs text-muted-foreground">
            Nothing open in this round — well done.
          </p>
        )}
        {jobs.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            className="flex w-full items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-3 text-left active:bg-amber-400/10"
          >
            <span className="text-2xl leading-none">{META[c.dimension].emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{name(c)}</span>
              <span className="mt-0.5 block whitespace-pre-line text-sm leading-snug">
                {c.brief?.trim() || trial.briefs[c.dimension]}
              </span>
              {c.takes > 0 && <span className="mt-1 block text-[11px] text-emerald-300">{c.takes} take{c.takes === 1 ? "" : "s"} in — tap to add or finish</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1 self-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              <Upload className="h-3.5 w-3.5" /> Shoot
            </span>
          </button>
        ))}
      </section>

      {/* The rounds, small: the reels, their plays, the winner. */}
      {DIMS.map((d, i) => {
        const row = trial.cells.filter((c) => c.dimension === d).sort((a, b) => a.slot - b.slot);
        if (!row.length) return null;
        const state = i < pIdx ? "decided" : i === pIdx ? "now" : "later";
        return (
          <section key={d} className="rounded-2xl border border-border/50 bg-card p-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">
                {META[d].emoji} {META[d].title}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {doneCount(row)}/{row.length} shot{state === "decided" ? " · decided" : state === "now" ? " · now" : ""}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {row.map((c) => (
                <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="min-w-0 text-left">
                  <div
                    className={`relative aspect-[9/16] overflow-hidden rounded-lg ${
                      c.state === "empty" ? "border border-dashed border-border bg-muted/20" : "bg-muted"
                    } ${c.winner ? "ring-2 ring-amber-400" : ""}`}
                  >
                    {c.thumb && <img src={c.thumb} alt="" className="h-full w-full object-cover" />}
                    {c.state === "empty" && (
                      <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                        <Plus className="h-4 w-4" />
                      </span>
                    )}
                    {c.winner && (
                      <span className="absolute left-1 top-1 rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black">🏆</span>
                    )}
                    {c.state !== "empty" && (
                      <span className={`absolute right-1 top-1 rounded-full px-1 text-[9px] font-semibold ${STATE_CHIP[c.state].cls}`}>
                        {c.state === "posted" ? "✓" : c.state === "takes" ? c.takes : "✓"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] font-medium">{name(c)}</p>
                  {c.plays.length ? (
                    c.plays.slice(0, 3).map((p) => (
                      <p key={p.accountId} className="flex justify-between gap-1 text-[10px] text-muted-foreground">
                        <span className="truncate">{p.label.replace(/^@/, "")}</span>
                        <span className="shrink-0 tabular-nums text-foreground">{short(p.views)}</span>
                      </p>
                    ))
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{c.state === "empty" ? "to shoot" : "not posted"}</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A take in the box: the card the upload page draws, and its asset once it is stored. */
type CellTake = GridTake & { assetId: string | null };

/** One box: drop the takes, then finish to send it to editing. */
function CellSheet({
  cell,
  trial,
  staff,
  onClose,
  onChanged,
}: {
  cell: MatrixCell | null;
  trial: MatrixTrial;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<CellTake[]>([]);
  const [finishing, startFinish] = useTransition();
  const [label, setLabel] = useState("");
  const [takesBase, setTakesBase] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  // IG / Fansly as she sets it, read when a take is stored — she may tap before its upload is done.
  const fanslyRef = useRef(new Map<string, boolean>());
  const uploading = list.some((r) => r.status === "uploading" || r.status === "waiting");
  const done = list.filter((r) => r.status === "done").length;
  const takes = Math.max(cell?.takes ?? 0, (takesBase ?? cell?.takes ?? 0) + done);
  const finished = !!cell && (cell.state === "finished" || cell.state === "edited" || cell.state === "posted");
  const patch = (id: string, p: Partial<CellTake>) => setList((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const reset = () => {
    setList([]);
    setLabel("");
    setTakesBase(null);
    setRequestId(null);
    fanslyRef.current.clear();
  };

  async function addTakes(picked: FileList | null) {
    if (!cell || !picked?.length) return;
    const files = Array.from(picked).filter(isMediaFile);
    if (!files.length) return void toast.error("Those aren't photos or videos");
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`${tooBig.length} take(s) are over ${MAX_UPLOAD_MB} MB and will fail`);
    if (takesBase === null) setTakesBase(cell.takes);
    const fresh: CellTake[] = files.map((file) => ({ id: crypto.randomUUID(), file, fansly: false, status: "waiting", pct: 0, assetId: null }));
    setList((l) => [...l, ...fresh]);
    const job = await openCellJob(cell.id);
    if (job.error || !job.requestId) {
      fresh.forEach((t) => patch(t.id, { status: "error" }));
      return void toast.error(job.error ?? "Could not start the job");
    }
    setRequestId(job.requestId);
    const supabase = createClient();
    let thumbDone = !!cell.thumb;
    const queue = [...fresh];
    const lane = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        const f = t.file;
        const path = `personas/${job.personaId}/requests/${job.requestId}/raw/${crypto.randomUUID()}_${safeStorageName(f.name)}`;
        patch(t.id, { status: "uploading" });
        try {
          await uploadToStorage(supabase, path, f, (pct) => patch(t.id, { pct }));
          const res = await recordTake({
            cellId: cell.id,
            requestId: job.requestId!,
            file_path: path,
            file_name: f.name,
            mime_type: resolveMime(f),
            size_bytes: f.size,
            fansly: fanslyRef.current.get(t.id) ?? false,
          });
          if (res.error || !res.id) throw new Error(res.error ?? "not saved");
          // Tapped while it was being stored: the asset follows.
          const now = fanslyRef.current.get(t.id) ?? false;
          if (now !== (res.fansly ?? false)) await setAssetFansly(res.id, job.requestId!, now).catch(() => null);
          patch(t.id, { pct: 100, status: "done", assetId: res.id });
          if (!thumbDone) {
            thumbDone = true;
            const blob = await generateThumbnail(f, resolveMime(f));
            if (blob) {
              const tp = `personas/${job.personaId}/trials/${trial.id}/${cell.id}.jpg`;
              const { error } = await supabase.storage.from("content-assets").upload(tp, blob, { contentType: "image/jpeg", upsert: true });
              if (!error) await setCellThumb(cell.id, tp);
            }
          }
        } catch (e) {
          patch(t.id, { status: "error" });
          toast.error(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
    };
    await Promise.all([lane(), lane()]);
    onChanged();
  }

  function toggleFansly(t: CellTake) {
    const next = !t.fansly;
    fanslyRef.current.set(t.id, next);
    patch(t.id, { fansly: next });
    if (t.assetId && requestId) {
      void setAssetFansly(t.assetId, requestId, next).catch(() => toast.error("Could not switch that take"));
    }
  }

  return (
    <Sheet
      open={!!cell}
      onOpenChange={(o) => {
        if (!o && uploading) return void toast.message("Takes are still uploading — keep this open");
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-5 sm:mx-auto sm:max-w-lg">
        {cell && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{name(cell)}</SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">{trial.briefs[cell.dimension]}</SheetDescription>
            </SheetHeader>
            {cell.brief && (
              <div className="mt-3 rounded-lg border border-primary/40 bg-primary/10 p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary">What to do in this one</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{cell.brief}</p>
              </div>
            )}

            <p className="mt-4 text-sm">
              {cell.state === "posted"
                ? `Posted${cell.views != null ? ` · ${nf.format(cell.views)} plays` : ""}`
                : cell.state === "edited"
                  ? "Cut — waiting to be posted"
                  : finished
                    ? `With the editor · ${takes} take${takes === 1 ? "" : "s"}`
                    : takes > 0
                      ? `${takes} take${takes === 1 ? "" : "s"} uploaded`
                      : "No takes yet"}
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="video/*,image/*,.mov,.MOV"
              multiple
              className="hidden"
              onChange={(e) => {
                addTakes(e.target.files);
                e.target.value = "";
              }}
            />
            {cell.state !== "posted" && cell.state !== "edited" && (
              <div className="mt-5 space-y-2">
                <TakeGrid
                  takes={list}
                  maxMb={MAX_UPLOAD_MB}
                  disabled={finishing}
                  onAdd={() => fileRef.current?.click()}
                  onRemove={(t) => {
                    if (t.assetId) return void toast.message("Stored takes are removed on the job page");
                    setList((l) => l.filter((x) => x.id !== t.id));
                  }}
                  onRetry={() => fileRef.current?.click()}
                  onFansly={toggleFansly}
                />
                {!finished && takes > 0 && (
                  <Button
                    className="h-12 w-full text-base"
                    disabled={uploading || finishing}
                    onClick={() =>
                      startFinish(async () => {
                        const r = await finishCell(cell.id);
                        if (r.error) return void toast.error(r.error);
                        toast.success(`${name(cell)} sent to editing`);
                        reset();
                        onClose();
                        onChanged();
                      })
                    }
                  >
                    {finishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Done — send to editing
                  </Button>
                )}
                <p className="text-center text-[11px] text-muted-foreground">
                  {finished ? "More takes still go to the same job." : "You can add takes over several days, then press done."}
                </p>
              </div>
            )}

            {staff && (
              <div className="mt-5 flex gap-2 border-t border-border/50 pt-4">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={cell.label ?? 'Name it, e.g. "black dress"'} className="h-9 text-sm" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={!label.trim()}
                  onClick={async () => {
                    const r = await setCellLabel(cell.id, label);
                    if (r.error) toast.error(r.error);
                    else {
                      setLabel("");
                      onChanged();
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Staff only: how many variations a round of a new trial starts with. This one is changed with + and the move menu. */
function ReshootCount({ value, onChanged }: { value: number; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const change = (n: number) =>
    start(async () => {
      const res = await setDefaultReshoots(n);
      if (res.error) toast.error(res.error);
      else onChanged();
    });
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium">New trials start with</p>
        <p className="text-[10px] text-muted-foreground">variations per round — this one you change with + and the move menu</p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={pending || value <= 1}
          onClick={() => change(value - 1)}
          aria-label="Fewer reshoots"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-7 text-center text-sm font-semibold tabular-nums">
          {pending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : value}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={pending || value >= 12}
          onClick={() => change(value + 1)}
          aria-label="More reshoots"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
