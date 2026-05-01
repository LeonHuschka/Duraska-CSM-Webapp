"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ArrowUpDown,
  Calendar,
  Tag,
  Clock,
  ExternalLink,
  TrendingUp,
  CalendarDays,
  Search,
  X,
  LayoutGrid,
  List,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContentRequest, ContentType } from "@/lib/types/database";
import { CreateRequestDialog } from "@/components/requests/create-request-dialog";

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  heavy: "bg-red-500/15 text-red-400 border-red-500/30",
};

type SortKey = "due_date" | "created_at" | "effort" | "art" | "status";

const EFFORT_ORDER: Record<string, number> = {
  easy: 0,
  medium: 1,
  high: 2,
  heavy: 3,
};

interface ProduceViewProps {
  requests: ContentRequest[];
  contentTypes: ContentType[];
  openCount: number;
  shotLastWeek: number;
  isModel?: boolean;
  advanceCount?: number;
  daysOfContent?: number;
  weeklyTarget?: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7) return `${diff}d left`;
  return formatDate(dateStr);
}

const TARGET_DAYS = 10; // desired advance buffer in days

export function ProduceView({
  requests,
  contentTypes,
  openCount,
  shotLastWeek,
  isModel = false,
  advanceCount = 0,
  daysOfContent = 0,
  weeklyTarget = 0,
}: ProduceViewProps) {
  const [sortBy, setSortBy] = useState<SortKey>("due_date");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "compact">("cards");

  const typeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of contentTypes) map[t.id] = t.name;
    return map;
  }, [contentTypes]);

  const filtered = useMemo(() => {
    let items = requests;
    if (!isModel && filterStatus !== "all") {
      items = items.filter((r) => r.status === filterStatus);
    }
    if (filterType !== "all") {
      items = items.filter((r) => r.content_type_id === filterType);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.inspo_link?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [requests, filterStatus, filterType, search, isModel]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "due_date":
        return arr.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        });
      case "created_at":
        return arr.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
      case "effort":
        return arr.sort(
          (a, b) =>
            (EFFORT_ORDER[b.priority] ?? 1) - (EFFORT_ORDER[a.priority] ?? 1)
        );
      case "art":
        return arr.sort((a, b) => {
          const nameA = a.content_type_id
            ? (typeMap[a.content_type_id] ?? "")
            : "";
          const nameB = b.content_type_id
            ? (typeMap[b.content_type_id] ?? "")
            : "";
          return nameA.localeCompare(nameB);
        });
      case "status":
        return arr.sort((a, b) => a.status.localeCompare(b.status));
      default:
        return arr;
    }
  }, [filtered, sortBy, typeMap]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your content production overview
          </p>
        </div>
        <CreateRequestDialog contentTypes={contentTypes} />
      </div>

      {/* Stats — 1 col on mobile, 3 on sm+ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">

        {/* Card 1: Open Requests */}
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/15 p-2.5 shrink-0">
              <Camera className="h-5 w-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{openCount}</p>
              <p className="text-xs text-muted-foreground">Open Requests</p>
            </div>
          </div>
        </div>

        {/* Card 2: Shot this week + progress toward weekly target */}
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/15 p-2.5 shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <p className="text-2xl font-bold">{shotLastWeek}</p>
                {weeklyTarget > 0 && (
                  <span className="text-sm text-muted-foreground">/ {weeklyTarget}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Shot this week</p>
              {weeklyTarget > 0 && (
                <p className={`mt-0.5 text-[11px] font-medium ${
                  shotLastWeek >= weeklyTarget ? "text-green-400" : "text-amber-400"
                }`}>
                  {shotLastWeek >= weeklyTarget
                    ? "Weekly target reached ✓"
                    : `${weeklyTarget - shotLastWeek} to go`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: Role-specific — Model sees advance count, VA sees days of content */}
        {isModel ? (
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/15 p-2.5 shrink-0">
                <TrendingUp className="h-5 w-5 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{advanceCount}</p>
                <p className="text-xs text-muted-foreground">In advance</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/60">shot + edited + scheduled</p>
              </div>
            </div>
          </div>
        ) : (
          <div className={`rounded-xl border bg-card p-4 ${
            daysOfContent >= TARGET_DAYS
              ? "border-green-500/40"
              : daysOfContent >= 7
                ? "border-amber-500/40"
                : "border-red-500/40"
          }`}>
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2.5 shrink-0 ${
                daysOfContent >= TARGET_DAYS
                  ? "bg-green-500/15"
                  : daysOfContent >= 7
                    ? "bg-amber-500/15"
                    : "bg-red-500/15"
              }`}>
                <CalendarDays className={`h-5 w-5 ${
                  daysOfContent >= TARGET_DAYS
                    ? "text-green-400"
                    : daysOfContent >= 7
                      ? "text-amber-400"
                      : "text-red-400"
                }`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-bold">{daysOfContent}d</p>
                  <span className="text-sm text-muted-foreground">/ {TARGET_DAYS}d</span>
                </div>
                <p className="text-xs text-muted-foreground">Advance content</p>
                <p className={`mt-0.5 text-[11px] font-medium ${
                  daysOfContent >= TARGET_DAYS
                    ? "text-green-400"
                    : daysOfContent >= 7
                      ? "text-amber-400"
                      : "text-red-400"
                }`}>
                  {daysOfContent >= TARGET_DAYS
                    ? "Buffer full ✓"
                    : `${TARGET_DAYS - daysOfContent}d still needed`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by title, description, link…"
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

      {/* Controls */}
      <div className="space-y-2">
        {/* Filter/sort row — single horizontal line, scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sort</span>
          </div>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_date">Due Date</SelectItem>
              <SelectItem value="created_at">Newest</SelectItem>
              <SelectItem value="effort">Effort</SelectItem>
              <SelectItem value="art">Art</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>

          {!isModel && (
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[120px] h-8 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="requested">Requested</SelectItem>
                <SelectItem value="shooted">Shooted</SelectItem>
                <SelectItem value="edited">Edited</SelectItem>
              </SelectContent>
            </Select>
          )}

          {contentTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[120px] h-8 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {contentTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Count + view toggle row */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {sorted.length} request{sorted.length !== 1 ? "s" : ""}
          </span>

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-card p-0.5">
            <button
              onClick={() => setViewMode("cards")}
              className={`rounded-md p-1.5 transition-colors ${
                viewMode === "cards"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("compact")}
              className={`rounded-md p-1.5 transition-colors ${
                viewMode === "compact"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Compact view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tile Grid */}
      {sorted.length === 0 ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
          <div className="rounded-xl bg-primary/10 p-3">
            <Camera className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No requests to show</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {filterStatus !== "all" || filterType !== "all"
              ? "Try adjusting your filters."
              : "All caught up!"}
          </p>
        </div>
      ) : viewMode === "compact" ? (
        /* Compact view — dense title-only tiles */
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sorted.map((request) => (
            <Link
              key={request.id}
              href={`/requests/${request.id}`}
              className={`group rounded-lg border px-3 py-2.5 transition-all duration-150 ${
                request.is_nsfw
                  ? "border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50"
                  : "border-border/50 bg-card hover:border-border hover:bg-accent/30"
              }`}
            >
              <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                {request.title}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                  request.is_nsfw ? "bg-blue-400" : "bg-green-400"
                }`} />
                {request.content_type_id && typeMap[request.content_type_id] && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {typeMap[request.content_type_id]}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        /* Card view */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((request) => {
            const typeName = request.content_type_id
              ? typeMap[request.content_type_id]
              : null;
            const isOverdue =
              request.due_date &&
              new Date(request.due_date + "T00:00:00") < new Date() &&
              request.status === "requested";

            return (
              <Link
                key={request.id}
                href={`/requests/${request.id}`}
                className={`group rounded-xl border p-4 transition-all duration-200 ${
                  request.is_nsfw
                    ? "border-blue-500/40 bg-blue-500/5 hover:border-blue-500/60"
                    : "border-border/50 bg-card hover:border-border hover:bg-accent/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug line-clamp-2">
                    {request.title}
                  </h3>
                  {request.is_nsfw ? (
                    <Badge variant="outline" className="shrink-0 text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/30">
                      NSFW
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-[10px] bg-green-500/15 text-green-400 border-green-500/30">
                      SFW
                    </Badge>
                  )}
                </div>

                {request.description && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
                    {request.description}
                  </p>
                )}

                {request.inspo_link && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1.5">
                    <ExternalLink className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-[11px] text-primary truncate">
                      {request.inspo_link}
                    </span>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {typeName && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Tag className="h-3 w-3" />
                      {typeName}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 capitalize ${EFFORT_STYLES[request.priority] ?? EFFORT_STYLES.medium}`}
                  >
                    {request.priority}
                  </Badge>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  {request.due_date && (
                    <span
                      className={`flex items-center gap-1 text-[11px] ${
                        isOverdue
                          ? "font-medium text-red-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      <Calendar className="h-3 w-3" />
                      {formatRelativeDate(request.due_date)}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                    <Clock className="h-3 w-3" />
                    {new Date(request.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
