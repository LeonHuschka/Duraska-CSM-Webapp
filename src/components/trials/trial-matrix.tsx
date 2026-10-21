"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clapperboard,
  Eye,
  Film,
  Flame,
  FlaskConical,
  Loader2,
  Lock,
  Plus,
  Send,
  Trophy,
  Upload,
} from "lucide-react";
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
  finishCell,
  openCellJob,
  recordTake,
  setCellLabel,
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
};
export type MatrixTrial = {
  id: string;
  personaId: string;
  account: { label: string; platform: string; avatar: string | null; median: number | null } | null;
  postUrl: string | null;
  caption: string | null;
  cover: string | null;
  views: number | null;
  lift: number | null;
  sourceTitle: string | null;
  phase: Phase;
  status: string;
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

export function TrialMatrix({ trial, staff, backHref }: { trial: MatrixTrial; staff: boolean; backHref: string }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deciding, startDecide] = useTransition();
  const open = trial.cells.find((c) => c.id === openId) ?? null;
  const pIdx = phaseIdx(trial.phase);

  // A cell whose picture could not be drawn while uploading — a phone that
  // locked, a tab in the background — gets it from its first take now.
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
      if (any && !cancelled) router.refresh();
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
  }, [trial.cells, trial.id, trial.personaId, router]);
  const winners = (d: Dimension) => trial.cells.filter((c) => c.dimension === d && c.winner).map(name);

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-16">
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-300">
          <FlaskConical className="h-3.5 w-3.5" /> Trial-Maxxing
        </span>
      </div>

      {/* The outlier */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 via-card to-card p-4">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex gap-4">
          <a
            href={trial.postUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-2xl bg-muted ring-2 ring-amber-400 sm:w-32"
          >
            {trial.cover ? (
              <img src={trial.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">no cover</span>
            )}
            <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-black">
              <Flame className="h-3 w-3" />
              {trial.lift ? `${trial.lift.toFixed(1)}×` : "outlier"}
            </span>
          </a>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">The outlier</p>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{trial.views != null ? short(trial.views) : "—"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              plays
              {trial.account?.median ? ` · usual on this account ${short(trial.account.median)}` : ""}
            </p>
            {trial.account && (
              <div className="mt-3 flex items-center gap-2">
                <AccountAvatar src={trial.account.avatar} platform={trial.account.platform} label={trial.account.label} size={24} />
                <span className="truncate text-xs font-medium">{trial.account.label}</span>
              </div>
            )}
            {trial.caption && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{trial.caption}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              {trial.sourceTitle && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{trial.sourceTitle}</span>}
              {trial.postUrl && (
                <a href={trial.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-amber-300 hover:underline">
                  Watch it <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* The three rounds */}
        <div className="relative mt-4 grid grid-cols-4 gap-1.5">
          {[...DIMS, "done" as const].map((p, i) => {
            const done = i < pIdx;
            const now = i === pIdx;
            return (
              <div
                key={p}
                className={`rounded-xl px-2 py-1.5 text-center text-[10px] font-medium ${
                  now ? "bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30" : done ? "bg-emerald-500/15 text-emerald-300" : "bg-muted/50 text-muted-foreground"
                }`}
              >
                <span className="block text-sm leading-none">{p === "done" ? "🏁" : META[p].emoji}</span>
                {p === "done" ? "Pattern" : META[p].title}
              </div>
            );
          })}
        </div>
      </div>

      {trial.phase === "done" && (
        <div className="rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-300">🏁 Pattern found</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            {DIMS.map((d) => (
              <div key={d} className="rounded-xl bg-background/40 p-2">
                <p className="text-base">{META[d].emoji}</p>
                <p className="font-medium">{winners(d).join(", ") || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {DIMS.map((d, i) => {
        const row = trial.cells.filter((c) => c.dimension === d).sort((a, b) => a.slot - b.slot);
        const isOpen = i <= pIdx;
        const isNow = i === pIdx;
        const decided = i < pIdx;
        const shot = row.filter((c) => c.state !== "empty" && c.state !== "takes").length;
        const posted = row.filter((c) => c.state === "posted").length;
        const ranked = row.filter((c) => c.views != null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
        const top = Math.max(1, ...ranked.map((c) => c.views ?? 0));
        return (
          <section
            key={d}
            className={`rounded-3xl border p-4 transition-colors ${
              isNow ? "border-fuchsia-500/50 bg-card shadow-lg shadow-fuchsia-500/5" : "border-border/50 bg-card/60"
            } ${!isOpen ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Round {i + 1}</p>
                <h2 className="mt-0.5 flex items-center gap-2 text-lg font-semibold">
                  <span>{META[d].emoji}</span> 6 {META[d].title}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  decided ? "bg-emerald-500/15 text-emerald-300" : isNow ? "bg-fuchsia-500/15 text-fuchsia-300" : "bg-muted text-muted-foreground"
                }`}
              >
                {decided ? "Decided ✓" : isNow ? `${shot}/6 shot · ${posted} posted` : "Locked"}
              </span>
            </div>
            {isOpen && !decided && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{trial.briefs[d]}</p>}
            {decided && winners(d).length > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-medium text-amber-300">
                <Trophy className="h-3.5 w-3.5" /> {winners(d).join(" & ")}
              </p>
            )}
            {!isOpen && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Opens once {META[DIMS[i - 1]].title.toLowerCase()} are decided.
              </p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {row.map((c) => (
                <CellTile key={c.id} c={c} locked={!isOpen} onOpen={() => isOpen && setOpenId(c.id)} />
              ))}
            </div>

            {/* The analysis: what each variation drew once posted */}
            {ranked.length > 0 && (
              <div className="mt-4 space-y-1.5 rounded-2xl bg-background/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Analysis · plays</p>
                {ranked.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 shrink-0 truncate">{name(c)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={`block h-full rounded-full ${c.winner ? "bg-amber-400" : "bg-fuchsia-500/70"}`}
                        style={{ width: `${((c.views ?? 0) / top) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right font-medium tabular-nums">{short(c.views ?? 0)}</span>
                    {staff && !decided && (
                      <button
                        type="button"
                        onClick={() =>
                          startDecide(async () => {
                            const r = await toggleWinner(c.id);
                            if (r.error) toast.error(r.error);
                            router.refresh();
                          })
                        }
                        className={`rounded-md p-1 ${c.winner ? "text-amber-300" : "text-muted-foreground/50 hover:text-amber-300"}`}
                        title={c.winner ? "Winner — click to undo" : "Mark as winner"}
                      >
                        <Trophy className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {staff && isNow && trial.status === "active" && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {row.some((c) => c.winner)
                    ? `Winners: ${row.filter((c) => c.winner).map(name).join(", ")}`
                    : "No winner picked — the two with most plays win."}
                </p>
                <Button
                  size="sm"
                  disabled={deciding || posted === 0}
                  onClick={() =>
                    startDecide(async () => {
                      const r = await advanceTrial(trial.id);
                      if (r.error) toast.error(r.error);
                      else toast.success(i < 2 ? `Round ${i + 2} is open — the model gets a message` : "Pattern found 🏁");
                      router.refresh();
                    })
                  }
                  className="bg-fuchsia-600 hover:bg-fuchsia-500"
                >
                  {deciding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trophy className="mr-1.5 h-3.5 w-3.5" />}
                  {i < 2 ? `Decide · start ${META[DIMS[i + 1]].title.toLowerCase()}` : "Decide · pattern found"}
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {staff && trial.status === "active" && (
        <div className="text-center">
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-rose-400 hover:underline"
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

      <CellSheet
        cell={open}
        trial={trial}
        staff={staff}
        onClose={() => setOpenId(null)}
        onChanged={() => router.refresh()}
      />
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
      className={`group relative aspect-[4/5] overflow-hidden rounded-2xl text-left transition-all active:scale-[0.97] ${
        filled ? "bg-muted" : locked ? "border border-border/40 bg-muted/20" : "border-2 border-dashed border-fuchsia-500/40 bg-fuchsia-500/5 hover:border-fuchsia-400 hover:bg-fuchsia-500/10"
      } ${c.winner ? "ring-[3px] ring-amber-400" : ""}`}
    >
      {filled && c.thumb && <img src={c.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {filled && !c.thumb && (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-fuchsia-500/30 to-violet-600/30">
          <Film className="h-6 w-6 text-white/70" />
        </span>
      )}
      {!filled && (
        <span className="absolute inset-0 flex items-center justify-center">
          {locked ? (
            <Lock className="h-4 w-4 text-muted-foreground/50" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-300 transition-transform group-hover:scale-110">
              <Plus className="h-5 w-5" />
            </span>
          )}
        </span>
      )}

      {/* The cell's status, top right: takes · ✓ · 100% */}
      {c.state === "takes" && (
        <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white backdrop-blur">
          <Film className="h-3 w-3" />
          {c.takes}
        </span>
      )}
      {(c.state === "finished" || c.state === "edited") && (
        <span
          className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ${
            c.state === "edited" ? "bg-sky-500" : "bg-emerald-500"
          } text-white shadow`}
          title={c.state === "edited" ? "Cut and ready to post" : "All takes in — with the editor"}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      )}
      {c.state === "posted" && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-1.5 py-0.5 text-[11px] font-black text-black shadow">
          100%
        </span>
      )}
      {c.winner && (
        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-black shadow">
          <Trophy className="h-3.5 w-3.5" />
        </span>
      )}

      <span
        className={`absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-5 text-[10px] font-medium leading-tight ${
          filled ? "bg-gradient-to-t from-black/80 to-transparent text-white" : "text-muted-foreground"
        }`}
      >
        <span className="block truncate">{name(c)}</span>
        {c.views != null && (
          <span className="flex items-center gap-0.5 font-semibold tabular-nums text-white">
            <Eye className="h-3 w-3" />
            {short(c.views)}
          </span>
        )}
      </span>
    </button>
  );
}

type UploadRow = { name: string; pct: number; status: "uploading" | "done" | "error" };

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
  // Takes the server knew of when this round of uploads began; the page
  // refreshes after it and then counts them itself.
  const [takesBase, setTakesBase] = useState<number | null>(null);
  const uploading = rows.some((r) => r.status === "uploading");
  const done = rows.filter((r) => r.status === "done").length;
  const takes = Math.max(cell?.takes ?? 0, (takesBase ?? cell?.takes ?? 0) + done);
  const brief = cell ? trial.briefs[cell.dimension] : "";

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
    const base = rows.length;
    setRows((r) => [...r, ...files.map((f) => ({ name: f.name, pct: 0, status: "uploading" as const }))]);
    let thumbDone = !!cell.thumb;
    const queue = files.map((f, i) => ({ f, i: base + i }));
    const lane = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const { f, i } = next;
        const path = `personas/${job.personaId}/requests/${job.requestId}/raw/${crypto.randomUUID()}_${safeStorageName(f.name)}`;
        try {
          await uploadToStorage(supabase, path, f, (pct) =>
            setRows((r) => r.map((x, j) => (j === i ? { ...x, pct } : x)))
          );
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
          // The first take becomes the cell's picture — one frame, read
          // locally, so she does not wait for it.
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

  const finished = cell && (cell.state === "finished" || cell.state === "edited" || cell.state === "posted");

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
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-border/60 p-5 sm:mx-auto sm:max-w-lg">
        {cell && (
          <>
            <SheetHeader className="text-left">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                {META[cell.dimension].emoji} {META[cell.dimension].title} · {cell.slot} of 6
              </p>
              <SheetTitle className="text-xl">{name(cell)}</SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">{brief}</SheetDescription>
            </SheetHeader>

            {staff && (
              <div className="mt-3 flex gap-2">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={cell.label ?? `Name it — e.g. "black dress"`}
                  className="h-9 text-sm"
                />
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
                  Save name
                </Button>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Step on={takes > 0} icon={<Upload className="h-4 w-4" />} label={takes > 0 ? `${takes} take${takes === 1 ? "" : "s"}` : "Takes"} />
              <Step on={!!finished} icon={<Clapperboard className="h-4 w-4" />} label="Editing" />
              <Step on={cell.state === "posted"} icon={<CheckCircle2 className="h-4 w-4" />} label={cell.state === "posted" ? "Posted" : "Posted"} />
            </div>

            {cell.state === "posted" && (
              <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-300">
                Live{cell.views != null ? ` · ${nf.format(cell.views)} plays so far` : " · plays come in with the next morning read"}
              </p>
            )}

            {rows.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                    <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {r.status === "uploading" && <span className="tabular-nums text-muted-foreground">{r.pct}%</span>}
                    {r.status === "done" && <Check className="h-4 w-4 text-emerald-400" />}
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
                  className={`h-12 w-full text-base ${takes > 0 ? "" : "bg-fuchsia-600 hover:bg-fuchsia-500"}`}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {takes > 0 ? "Add more takes" : "Upload takes"}
                </Button>
                {!finished && (
                  <Button
                    className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-500"
                    disabled={takes === 0 || uploading || finishing}
                    onClick={() =>
                      startFinish(async () => {
                        const r = await finishCell(cell.id);
                        if (r.error) return void toast.error(r.error);
                        toast.success(`${name(cell)} is with the editor ✂️`);
                        reset();
                        onClose();
                        onChanged();
                      })
                    }
                  >
                    {finishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Finish — send to editing
                  </Button>
                )}
                <p className="text-center text-[11px] text-muted-foreground">
                  {finished
                    ? "In editing. More takes still go to the same job."
                    : "Upload today, add more tomorrow — finish when all takes are in."}
                </p>
              </div>
            )}
            {cell.title && <p className="mt-4 text-center text-[10px] text-muted-foreground">Job {cell.title}</p>}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Step({ on, icon, label }: { on: boolean; icon: React.ReactNode; label: string }) {
  return (
    <div className={`rounded-xl px-2 py-2.5 text-[11px] font-medium ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-muted/40 text-muted-foreground"}`}>
      <span className="mx-auto mb-1 flex justify-center">{icon}</span>
      {label}
    </div>
  );
}
