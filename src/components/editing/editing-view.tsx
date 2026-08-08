"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
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

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border/40 bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[10px] ${
                tab === t.value ? "bg-primary/20" : "bg-muted"
              }`}
            >
              {counts[t.value] ?? 0}
            </span>
          </button>
        ))}
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
      ) : (
        <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/40 bg-card">
          {filtered.map((job) => (
            <Link
              key={job.id}
              href={`/requests/${job.id}`}
              className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40 active:bg-accent/60"
            >
              {/* leading icon */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <Film className="h-4 w-4 text-muted-foreground" />
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
                <a
                  href={job.inspo_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  title="Open inspo reel"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
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
