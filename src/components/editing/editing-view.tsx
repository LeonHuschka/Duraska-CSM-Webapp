"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Scissors,
  ExternalLink,
  Search,
  X,
  CheckCircle2,
  Send,
  Film,
  ChevronRight,
  Trash2,
  Loader2,
  List,
  LayoutGrid,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TrialBadge } from "@/components/ui/trial-badge";
import { usePersona } from "@/hooks/use-persona";
import { deleteEditJob } from "@/app/(app)/editing/actions";
import type { EditJob } from "@/app/(app)/editing/page";

const TABS = [
  { value: "shooted", label: "To edit", icon: Scissors },
  { value: "edited", label: "Done", icon: CheckCircle2 },
  { value: "posted", label: "Posted", icon: Send },
] as const;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function EditingView({ jobs }: { jobs: EditJob[] }) {
  const [tab, setTab] = useState<string>("shooted");
  // List or cards — remembered per browser, the VA's own preference.
  const [view, setView] = useState<"list" | "cards">("list");
  useEffect(() => {
    try {
      const v = localStorage.getItem("editing-view");
      if (v === "cards" || v === "list") setView(v);
    } catch {}
  }, []);
  const pickView = (v: "list" | "cards") => {
    setView(v);
    try {
      localStorage.setItem("editing-view", v);
    } catch {}
  };
  const [search, setSearch] = useState("");
  const router = useRouter();
  const { activePersona } = usePersona();
  // Deleting wipes the model's footage — owners/managers only. (RLS blocks
  // VAs server-side too, this just keeps the button out of their way.)
  const canDelete =
    activePersona.role === "owner" || activePersona.role === "manager";
  const [confirmJob, setConfirmJob] = useState<EditJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirmJob) return;
    setDeleting(true);
    try {
      const res = await deleteEditJob(confirmJob.id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Deleted ${confirmJob.title}`);
      setConfirmJob(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { shooted: 0, edited: 0, posted: 0 };
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    let items = jobs.filter((j) => j.status === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.content_type_name?.toLowerCase().includes(q) ||
          j.inspo_link?.toLowerCase().includes(q) ||
          j.description?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [jobs, tab, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cut each job&apos;s takes to match its inspo.
        </p>
      </div>

      {/* Tabs, and beside them how to see the jobs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="glass-pill inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200",
                tab === t.value
                  ? "bg-white text-neutral-900 shadow-[0_6px_20px_-6px_rgba(255,255,255,0.55)]"
                  : "text-white/75 hover:bg-white/15 hover:text-white"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              <span className={cn("text-[11px] tabular-nums", tab === t.value ? "text-neutral-500" : "text-white/45")}>
                {counts[t.value] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="glass-pill inline-flex gap-1 rounded-full p-1">
          {(
            [
              { v: "list", label: "List", icon: List },
              { v: "cards", label: "Cards", icon: LayoutGrid },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              onClick={() => pickView(o.v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
                view === o.v ? "bg-white text-neutral-900" : "text-white/70 hover:bg-white/15 hover:text-white"
              )}
            >
              <o.icon className="h-3.5 w-3.5" />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 pl-9 pr-9"
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

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
          <div className="rounded-xl bg-primary/10 p-3">
            <Scissors className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-sm font-medium">
            {tab === "shooted" ? "Nothing to edit" : "Nothing here"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "shooted"
              ? "New uploads from the model show up here."
              : "Jobs move here as they progress."}
          </p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} canDelete={canDelete} onDelete={() => setConfirmJob(job)} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-border/50 bg-card">
          {filtered.map((job) => (
            <Link
              key={job.id}
              href={`/requests/${job.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.06] active:bg-white/10"
            >
              {/* leading icon */}
              <div className="relative flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                {job.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={job.previewImage} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Film className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* main */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{job.title}</span>
                  {job.is_trial && <TrialBadge size="sm" />}
                  {!job.is_nsfw ? null : (
                    <span className="rounded bg-blue-500/15 px-1 text-[9px] font-bold text-blue-400">
                      NSFW
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{job.content_type_name ?? "—"}</span>
                  <span>·</span>
                  <span>
                    {job.rawCount} take{job.rawCount === 1 ? "" : "s"}
                  </span>
                  {job.fanslyCount > 0 && (
                    <span className="rounded bg-sky-500/15 px-1 font-semibold text-sky-300">
                      {job.fanslyCount} Fansly
                    </span>
                  )}
                  {job.editedCount > 0 && (
                    <>
                      <span>·</span>
                      <span className="font-medium text-green-400">
                        {job.editedCount} cut{job.editedCount === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>{timeAgo(job.created_at)}</span>
                </div>

                {/* Her brief. For a reel she made up there is no inspo reel
                    to watch, so this is the only thing telling the editor
                    what it is supposed to be. */}
                {job.description &&
                  !/^(Self-produced based on inspo|Own idea)$/.test(
                    job.description
                  ) && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {job.description}
                    </p>
                  )}
              </div>

              {/* inspo quick-open */}
              {job.inspo_link && (
                <button
                  type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(job.inspo_link!, "_blank", "noopener,noreferrer");
                }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  title="Open inspo reel"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}

              {canDelete && (
                <button
                  onClick={(e) => {
                    // The row is a Link — don't navigate when deleting.
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmJob(job);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
                  title="Delete job and its files"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}

              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </Link>
          ))}
        </div>
      )}

      {/* Delete confirmation — this removes the model's footage for good. */}
      <Dialog
        open={!!confirmJob}
        onOpenChange={(o) => {
          if (!deleting && !o) setConfirmJob(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmJob?.title}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              This permanently removes{" "}
              <span className="font-medium text-foreground">
                {confirmJob?.rawCount ?? 0} take
                {confirmJob?.rawCount === 1 ? "" : "s"}
              </span>
              {(confirmJob?.editedCount ?? 0) > 0 && (
                <>
                  {" "}
                  and{" "}
                  <span className="font-medium text-foreground">
                    {confirmJob?.editedCount} cut
                    {confirmJob?.editedCount === 1 ? "" : "s"}
                  </span>
                </>
              )}{" "}
              from the app and from storage. It can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmJob(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 text-white hover:bg-red-600/90"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
                  </>
                ) : (
                  "Delete"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A job as a card: the inspo reel as its picture — it plays while the
 * pointer rests on it — with the title and counts over a dark fade.
 */
function JobCard({ job, canDelete, onDelete }: { job: EditJob; canDelete: boolean; onDelete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const brief =
    job.description && !/^(Self-produced based on inspo|Own idea)$/.test(job.description) ? job.description : null;
  return (
    <Link
      href={`/requests/${job.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-white/15 bg-card shadow-[0_12px_32px_-14px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:-translate-y-1"
      onMouseEnter={() => video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = video.current;
        if (v) {
          v.pause();
          v.currentTime = 0.5;
        }
      }}
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-black/40">
        {job.previewVideo ? (
          <video
            ref={video}
            src={`${job.previewVideo}#t=0.5`}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : job.previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.previewImage} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Film className="h-8 w-8 text-white/30" />
          </div>
        )}

        {/* Top: what kind of job, and the quick buttons */}
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
          <div className="flex flex-wrap gap-1">
            {job.is_trial && <TrialBadge size="sm" />}
            {job.is_nsfw && (
              <span className="rounded-full bg-blue-500/80 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">NSFW</span>
            )}
            {job.fanslyCount > 0 && (
              <span className="rounded-full bg-sky-500/80 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                {job.fanslyCount} Fansly
              </span>
            )}
          </div>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {job.inspo_link && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(job.inspo_link!, "_blank", "noopener,noreferrer");
                }}
                className="glass-pill flex h-7 w-7 items-center justify-center rounded-full text-white"
                title="Open inspo reel"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete();
                }}
                className="glass-pill flex h-7 w-7 items-center justify-center rounded-full text-white hover:text-rose-300"
                title="Delete job and its files"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {job.previewVideo && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-opacity group-hover:opacity-0">
            <Play className="h-4 w-4 fill-white" />
          </span>
        )}

        {/* Bottom: title and counts over a fade */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-3 pt-10">
          <p className="truncate text-sm font-semibold text-white">{job.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-white/70">
            <span>
              {job.rawCount} take{job.rawCount === 1 ? "" : "s"}
            </span>
            {job.editedCount > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-emerald-300">
                  {job.editedCount} cut{job.editedCount === 1 ? "" : "s"}
                </span>
              </>
            )}
            <span>·</span>
            <span>{timeAgo(job.created_at)}</span>
          </p>
          {brief && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/60">{brief}</p>}
        </div>
      </div>
    </Link>
  );
}
