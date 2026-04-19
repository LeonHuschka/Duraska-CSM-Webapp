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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContentRequest, ContentType } from "@/lib/types/database";

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  heavy: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  shooted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  edited: "bg-blue-500/15 text-blue-400 border-blue-500/30",
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

export function ProduceView({
  requests,
  contentTypes,
  openCount,
  shotLastWeek,
}: ProduceViewProps) {
  const [sortBy, setSortBy] = useState<SortKey>("due_date");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const typeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of contentTypes) map[t.id] = t.name;
    return map;
  }, [contentTypes]);

  const filtered = useMemo(() => {
    let items = requests;
    if (filterStatus !== "all") {
      items = items.filter((r) => r.status === filterStatus);
    }
    if (filterType !== "all") {
      items = items.filter((r) => r.content_type_id === filterType);
    }
    return items;
  }, [requests, filterStatus, filterType]);

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your content production overview
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/15 p-2.5">
              <Camera className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{openCount}</p>
              <p className="text-xs text-muted-foreground">Open Requests</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/15 p-2.5">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{shotLastWeek}</p>
              <p className="text-xs text-muted-foreground">Shot this week</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort
        </div>
        <Select
          value={sortBy}
          onValueChange={(v) => setSortBy(v as SortKey)}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
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

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="shooted">Shooted</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
          </SelectContent>
        </Select>

        {contentTypes.length > 0 && (
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
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

        <span className="ml-auto text-xs text-muted-foreground">
          {sorted.length} request{sorted.length !== 1 ? "s" : ""}
        </span>
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
      ) : (
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
                className="group rounded-xl border border-border/50 bg-card p-4 transition-all duration-200 hover:border-border hover:bg-accent/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug line-clamp-2">
                    {request.title}
                  </h3>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] capitalize ${STATUS_STYLES[request.status] ?? ""}`}
                  >
                    {request.status}
                  </Badge>
                </div>

                {request.description && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                    {request.description}
                  </p>
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
                  {request.inspo_link && (
                    <span className="ml-auto">
                      <ExternalLink className="h-3 w-3 text-primary/60 group-hover:text-primary" />
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
