"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Film,
  Scissors,
  ExternalLink,
  Search,
  X,
  CheckCircle2,
  Send,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { TrialBadge } from "@/components/ui/trial-badge";
import type { EditJob } from "@/app/(app)/editing/page";

const TABS = [
  { value: "shooted", label: "To edit", icon: Scissors },
  { value: "edited", label: "Done", icon: CheckCircle2 },
  { value: "posted", label: "Posted", icon: Send },
] as const;

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const day = 1000 * 60 * 60 * 24;
  const days = Math.floor(diff / day);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function EditingView({ jobs }: { jobs: EditJob[] }) {
  const [tab, setTab] = useState<string>("shooted");
  const [search, setSearch] = useState("");

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
          j.inspo_link?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [jobs, tab, search]);

  return (
    <div className="space-y-5">
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

      {/* Grid */}
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((job) => (
            <Link
              key={job.id}
              href={`/requests/${job.id}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-border/40 bg-card transition-all hover:border-border/70 hover:shadow-md"
            >
              {/* Preview */}
              <div className="relative aspect-[9/16] w-full overflow-hidden bg-muted/30">
                {job.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={job.thumbnailUrl}
                    alt={job.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-black">
                    <Film className="h-7 w-7 text-white/40" />
                  </div>
                )}

                {/* take count */}
                <div className="absolute left-2 top-2 flex items-center gap-1">
                  <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {job.rawCount} take{job.rawCount === 1 ? "" : "s"}
                  </span>
                  {job.is_trial && <TrialBadge size="sm" />}
                </div>

                {/* edited count / done indicator */}
                {job.editedCount > 0 && (
                  <div className="absolute right-2 top-2">
                    <span className="flex items-center gap-1 rounded-md bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      {job.editedCount} cut{job.editedCount === 1 ? "" : "s"}
                    </span>
                  </div>
                )}

                {/* inspo indicator */}
                {job.inspo_link && (
                  <div className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5">
                    <ExternalLink className="h-3 w-3 text-white" />
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <p className="truncate text-xs font-medium">{job.title}</p>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate">
                    {job.content_type_name ?? "—"}
                  </span>
                  <span className="shrink-0">{timeAgo(job.created_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
