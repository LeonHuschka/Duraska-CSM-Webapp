"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Film, Loader2, Lock, Minus, Play, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { generateThumbnail, generateThumbnailFromUrl, safeStorageName } from "@/lib/thumbnails";
import { isMediaFile, MAX_UPLOAD_MB, resolveMime, uploadToStorage } from "@/lib/upload-takes";
import { AccountAvatar } from "@/components/pipeline/account-avatar";
import {
  advanceTrial,
  archiveTrial,
  fetchOutlierVideo,
  finishCell,
  openCellJob,
  recordTake,
  setCellLabel,
  setCellThumb,
  setTrialReshoots,
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
};
export type MatrixTrial = {
  id: string;
  personaId: string;
  account: { label: string; platform: string; avatar: string | null; median: number | null } | null;
  postUrl: string | null;
  caption: string | null;
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
const META: Record<Dimension, { title: string; one: string }> = {
  outfit: { title: "Outfits", one: "Outfit" },
  location: { title: "Locations", one: "Location" },
  hook: { title: "Hooks", one: "Hook" },
};
const nf = new Intl.NumberFormat("de-DE");
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : nf.format(n);
const name = (c: Pick<MatrixCell, "dimension" | "slot" | "label">) => c.label?.trim() || `${META[c.dimension].one} ${c.slot}`;
const phaseIdx = (p: Phase) => (p === "done" ? 3 : DIMS.indexOf(p));
const doneCount = (row: MatrixCell[]) => row.filter((c) => c.state !== "empty" && c.state !== "takes").length;

/**
 * The trial: the outlier and the three rounds of six. On a phone only the
 * round she is in is open; the others are one line each. On a computer
 * it is the table from the whiteboard — a row per round, a column per
 * variation, the outlier on top.
 */
export function TrialMatrix({ trial, staff, backHref }: { trial: MatrixTrial; staff: boolean; backHref: string }) {
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        {trial.account && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <AccountAvatar src={trial.account.avatar} platform={trial.account.platform} label={trial.account.label} size={20} />
            {trial.account.label}
          </span>
        )}
      </div>

      {staff && <ReshootCount trialId={trial.id} value={trial.reshoots} onChanged={refresh} />}

      {/* ── Phone ── */}
      <div className="space-y-3 md:hidden">
        <OutlierCard trial={trial} />
        {DIMS.map((d, i) => (
          <MobileRound
            key={d}
            d={d}
            index={i}
            row={rows[i]}
            state={i < pIdx ? "decided" : i === pIdx ? "now" : "later"}
            brief={trial.briefs[d]}
            winners={winners(d)}
            staff={staff}
            trialId={trial.id}
            onOpen={setOpenId}
          />
        ))}
        {trial.phase === "done" && <Pattern trial={trial} winners={winners} />}
      </div>

      {/* ── Computer: the table ── */}
      <div className="hidden overflow-hidden rounded-2xl border border-border/50 bg-card md:block">
        <table className="w-full border-collapse">
          <tbody>
            <tr className="border-b border-border/50">
              <th className="w-44 p-4 text-left align-top text-sm font-medium">Outlier</th>
              <td className="p-4">
                <OutlierInline trial={trial} />
              </td>
            </tr>
            {DIMS.map((d, i) => {
              // Every round can be shot at any time; only the deciding goes in order.
              const state = i < pIdx ? "decided" : i === pIdx ? "now" : "later";
              return (
                <tr key={d} className="border-b border-border/50 last:border-0">
                  <th className="w-44 p-4 text-left align-top">
                    <p className="text-sm font-medium">
                      {rows[i].length} {META[d].title}
                    </p>
                    <p className="mt-1 text-[11px] font-normal text-muted-foreground">
                      {state === "decided" ? "Decided" : `${doneCount(rows[i])} of ${rows[i].length} shot`}
                    </p>
                    {state === "decided" && winners(d).length > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-normal text-amber-300">
                        <Trophy className="h-3 w-3" /> {winners(d).join(", ")}
                      </p>
                    )}
                    {state === "now" && staff && <DecideButton trialId={trial.id} index={i} row={rows[i]} compact />}
                  </th>
                  <td className="p-4">
                    {state !== "decided" && <p className="mb-3 text-xs text-muted-foreground">{trial.briefs[d]}</p>}
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(rows[i].length, 1), 6)}, minmax(0, 1fr))` }}
                    >
                      {rows[i].map((c) => (
                        <CellTile key={c.id} c={c} locked={false} onOpen={() => setOpenId(c.id)} />
                      ))}
                    </div>
                    {staff && rows[i].some((c) => c.views != null) && (
                      <Ranking row={rows[i]} decided={state === "decided"} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hidden md:block">{trial.phase === "done" && <Pattern trial={trial} winners={winners} />}</div>

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

      <CellSheet cell={open} trial={trial} staff={staff} onClose={() => setOpenId(null)} onChanged={() => router.refresh()} />
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

/** The outlier, playable: the reel she is reshooting. */
function OutlierPlayer({ trial, className }: { trial: MatrixTrial; className: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-muted ${className}`}>
      {playing && trial.video ? (
        <video src={trial.video} autoPlay controls playsInline className="h-full w-full bg-black object-cover" />
      ) : (
        <button
          type="button"
          onClick={() => (trial.video ? setPlaying(true) : trial.postUrl && window.open(trial.postUrl, "_blank", "noreferrer"))}
          className="group block h-full w-full"
        >
          {trial.cover && <img src={trial.cover} alt="" className="h-full w-full object-cover" />}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm transition-transform group-active:scale-95">
              {trial.video ? <Play className="h-5 w-5 fill-white text-white" /> : <Loader2 className="h-5 w-5 animate-spin text-white/70" />}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

function OutlierStats({ trial }: { trial: MatrixTrial }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">The reel to reshoot</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{trial.views != null ? nf.format(trial.views) : "—"}</p>
      <p className="text-[11px] text-muted-foreground">
        plays{trial.lift ? ` · ${trial.lift.toFixed(0)}× the usual` : ""}
      </p>
      {trial.caption && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{trial.caption}</p>}
      {trial.postUrl && (
        <a href={trial.postUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          Open on {trial.account?.platform === "facebook" ? "Facebook" : "Instagram"} <ArrowUpRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function OutlierCard({ trial }: { trial: MatrixTrial }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-border/50 bg-card p-3">
      <OutlierPlayer trial={trial} className="aspect-[9/16] w-28 shrink-0" />
      <OutlierStats trial={trial} />
    </div>
  );
}

function OutlierInline({ trial }: { trial: MatrixTrial }) {
  return (
    <div className="flex gap-5">
      <OutlierPlayer trial={trial} className="aspect-[9/16] w-32 shrink-0" />
      <OutlierStats trial={trial} />
    </div>
  );
}

function MobileRound({
  d,
  index,
  row,
  state,
  brief,
  winners,
  staff,
  trialId,
  onOpen,
}: {
  d: Dimension;
  index: number;
  row: MatrixCell[];
  state: "decided" | "now" | "later";
  brief: string;
  winners: string[];
  staff: boolean;
  trialId: string;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(state === "now");
  const shot = doneCount(row);
  const head = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="min-w-0 text-left">
        <p className="text-sm font-medium">
          {index + 1}. {META[d].title}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {state === "decided"
            ? winners.length
              ? `Winner: ${winners.join(", ")}`
              : "Decided"
            : `${shot} of ${row.length} shot`}
        </p>
      </div>
      {state !== "now" ? (
        <span className="flex shrink-0 items-center gap-2">
          {state === "decided" && <Check className="h-4 w-4 text-emerald-400" />}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      ) : null}
    </div>
  );
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      {state !== "now" ? (
        <button type="button" className="w-full" onClick={() => setExpanded((x) => !x)}>
          {head}
        </button>
      ) : (
        head
      )}
      {expanded && (
        <>
          {state !== "decided" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{brief}</p>}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {row.map((c) => (
              <CellTile key={c.id} c={c} locked={false} onOpen={() => onOpen(c.id)} />
            ))}
          </div>
          {staff && row.some((c) => c.views != null) && <Ranking row={row} decided={state === "decided"} />}
          {staff && state === "now" && <DecideButton trialId={trialId} index={index} row={row} />}
        </>
      )}
    </div>
  );
}

function CellTile({ c, locked, onOpen }: { c: MatrixCell; locked: boolean; onOpen: () => void }) {
  const filled = c.state !== "empty";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={locked}
      className={`relative aspect-[4/5] overflow-hidden rounded-xl text-left transition-transform active:scale-[0.97] ${
        filled ? "bg-muted" : "border border-dashed border-border bg-muted/20 hover:border-foreground/40"
      } ${c.winner ? "ring-2 ring-amber-400" : ""}`}
    >
      {filled && c.thumb && <img src={c.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {filled && !c.thumb && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Film className="h-5 w-5 text-muted-foreground" />
        </span>
      )}
      {!filled && (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          {locked ? <Lock className="h-4 w-4 opacity-50" /> : <Plus className="h-5 w-5" />}
        </span>
      )}

      {/* takes · ✓ · 100% */}
      {c.state === "takes" && (
        <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-black/70 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white">
          {c.takes}
        </span>
      )}
      {(c.state === "finished" || c.state === "edited") && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}
      {c.state === "posted" && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">100%</span>
      )}
      {c.winner && (
        <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-black">
          <Trophy className="h-3 w-3" />
        </span>
      )}

      <span
        className={`absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-4 text-[10px] leading-tight ${
          filled ? "bg-gradient-to-t from-black/70 to-transparent text-white" : "text-muted-foreground"
        }`}
      >
        <span className="block truncate">{name(c)}</span>
        {c.views != null && <span className="block font-semibold tabular-nums">{short(c.views)} plays</span>}
      </span>
    </button>
  );
}

/** Staff only: the posted variations by plays, with the winner switch. */
function Ranking({ row, decided }: { row: MatrixCell[]; decided: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const ranked = row.filter((c) => c.views != null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const top = Math.max(1, ...ranked.map((c) => c.views ?? 0));
  return (
    <div className="mt-3 space-y-1">
      {ranked.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0 truncate text-muted-foreground">{name(c)}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className={`block h-full rounded-full ${c.winner ? "bg-amber-400" : "bg-foreground/40"}`} style={{ width: `${((c.views ?? 0) / top) * 100}%` }} />
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums">{short(c.views ?? 0)}</span>
          {!decided && (
            <button
              type="button"
              onClick={() =>
                start(async () => {
                  const r = await toggleWinner(c.id);
                  if (r.error) toast.error(r.error);
                  router.refresh();
                })
              }
              className={`p-0.5 ${c.winner ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`}
              title={c.winner ? "Winner — click to undo" : "Mark as winner"}
            >
              <Trophy className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function DecideButton({ trialId, index, row, compact = false }: { trialId: string; index: number; row: MatrixCell[]; compact?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const posted = row.filter((c) => c.state === "posted").length;
  const next = DIMS[index + 1];
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || posted === 0}
      title={posted === 0 ? "Decide once something of this round is posted" : row.some((c) => c.winner) ? undefined : "Without a pick, the two with most plays win"}
      className={compact ? "mt-3 h-7 px-2 text-[11px]" : "mt-3 w-full"}
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
      {next ? `Decide · open ${META[next].title.toLowerCase()}` : "Decide · pattern found"}
    </Button>
  );
}

function Pattern({ trial, winners }: { trial: MatrixTrial; winners: (d: Dimension) => string[] }) {
  void trial;
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-sm font-medium">Pattern found</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        {DIMS.map((d) => (
          <div key={d} className="rounded-xl bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">{META[d].one}</p>
            <p className="font-medium">{winners(d).join(", ") || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type UploadRow = { name: string; pct: number; status: "uploading" | "done" | "error" };

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
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [finishing, startFinish] = useTransition();
  const [label, setLabel] = useState("");
  const [takesBase, setTakesBase] = useState<number | null>(null);
  const uploading = rows.some((r) => r.status === "uploading");
  const done = rows.filter((r) => r.status === "done").length;
  const takes = Math.max(cell?.takes ?? 0, (takesBase ?? cell?.takes ?? 0) + done);
  const finished = !!cell && (cell.state === "finished" || cell.state === "edited" || cell.state === "posted");

  const reset = () => {
    setRows([]);
    setLabel("");
    setTakesBase(null);
  };

  async function addTakes(list: FileList | null) {
    if (!cell || !list?.length) return;
    const files = Array.from(list).filter(isMediaFile);
    if (!files.length) return void toast.error("Those aren't photos or videos");
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`${tooBig.length} take(s) are over ${MAX_UPLOAD_MB} MB and will fail`);
    setBusy(true);
    if (takesBase === null) setTakesBase(cell.takes);
    const job = await openCellJob(cell.id);
    if (job.error || !job.requestId) {
      setBusy(false);
      return void toast.error(job.error ?? "Could not start the job");
    }
    const supabase = createClient();
    const start = rows.length;
    setRows((r) => [...r, ...files.map((f) => ({ name: f.name, pct: 0, status: "uploading" as const }))]);
    let thumbDone = !!cell.thumb;
    const queue = files.map((f, i) => ({ f, i: start + i }));
    const lane = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const { f, i } = next;
        const path = `personas/${job.personaId}/requests/${job.requestId}/raw/${crypto.randomUUID()}_${safeStorageName(f.name)}`;
        try {
          await uploadToStorage(supabase, path, f, (pct) => setRows((r) => r.map((x, j) => (j === i ? { ...x, pct } : x))));
          const res = await recordTake({
            cellId: cell.id,
            requestId: job.requestId!,
            file_path: path,
            file_name: f.name,
            mime_type: resolveMime(f),
            size_bytes: f.size,
          });
          if (res.error) throw new Error(res.error);
          setRows((r) => r.map((x, j) => (j === i ? { ...x, pct: 100, status: "done" } : x)));
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
          setRows((r) => r.map((x, j) => (j === i ? { ...x, status: "error" } : x)));
          toast.error(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
    };
    await Promise.all([lane(), lane()]);
    setBusy(false);
    onChanged();
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

            {rows.length > 0 && (
              <ul className="mt-3 space-y-1">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {r.status === "uploading" && <span className="tabular-nums">{r.pct}%</span>}
                    {r.status === "done" && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    {r.status === "error" && <span className="text-rose-400">failed</span>}
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="video/*,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addTakes(e.target.files);
                e.target.value = "";
              }}
            />
            {cell.state !== "posted" && cell.state !== "edited" && (
              <div className="mt-5 space-y-2">
                <Button
                  variant={takes > 0 ? "outline" : "default"}
                  className="h-12 w-full text-base"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {takes > 0 ? "Add more takes" : "Upload takes"}
                </Button>
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

/** Staff only: how many reshoots each round has — also what new trials start with. */
function ReshootCount({ trialId, value, onChanged }: { trialId: string; value: number; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const change = (n: number) =>
    start(async () => {
      const res = await setTrialReshoots(trialId, n);
      if (res.error) toast.error(res.error);
      else onChanged();
    });
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium">Reshoots per round</p>
        <p className="text-[10px] text-muted-foreground">For this trial and every new one</p>
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
