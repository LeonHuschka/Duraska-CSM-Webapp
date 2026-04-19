"use client";

import { useMemo, useState } from "react";
import type { ScheduleSlot, ContentRequest } from "@/lib/types/database";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlotCard } from "@/components/schedule/slot-card";
import { CreateSlotDialog } from "@/components/schedule/create-slot-dialog";
import {
  CalendarDays,
  List,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  Clock,
  Film,
} from "lucide-react";

interface ScheduleAsset {
  id: string;
  request_id: string;
  stage: string;
  file_name: string;
  mime_type: string | null;
  signedUrl: string;
}

interface ScheduleViewProps {
  slots: ScheduleSlot[];
  requests: Pick<ContentRequest, "id" | "title" | "status">[];
  assets?: ScheduleAsset[];
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateHeading(date: Date): string {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500",
  fansly: "bg-blue-500",
  tiktok: "bg-slate-600",
  other: "bg-gray-500",
};

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  ready: "bg-green-500/15 text-green-400 border-green-500/30",
  posted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function ScheduleView({ slots, requests, assets = [] }: ScheduleViewProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);

  const groupedByDate = useMemo(() => {
    const groups: Record<string, ScheduleSlot[]> = {};
    for (const slot of slots) {
      const d = new Date(slot.scheduled_for);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(slot);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset]
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const slotsByWeekDay = useMemo(() => {
    const map: Record<number, ScheduleSlot[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const slot of slots) {
      const d = new Date(slot.scheduled_for);
      const idx = weekDays.findIndex((wd) => isSameDay(wd, d));
      if (idx >= 0) map[idx].push(slot);
    }
    for (const key of Object.keys(map)) {
      map[Number(key)].sort(
        (a, b) =>
          new Date(a.scheduled_for).getTime() -
          new Date(b.scheduled_for).getTime()
      );
    }
    return map;
  }, [slots, weekDays]);

  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${weekStart.toLocaleDateString("en-US", opts)} - ${end.toLocaleDateString("en-US", opts)}, ${end.getFullYear()}`;
  }, [weekStart]);

  const selectedDay = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);

  const dailySlots = useMemo(() => {
    return slots
      .filter((s) => isSameDay(new Date(s.scheduled_for), selectedDay))
      .sort(
        (a, b) =>
          new Date(a.scheduled_for).getTime() -
          new Date(b.scheduled_for).getTime()
      );
  }, [slots, selectedDay]);

  const assetsByRequest = useMemo(() => {
    const map: Record<string, ScheduleAsset[]> = {};
    for (const asset of assets) {
      if (!map[asset.request_id]) map[asset.request_id] = [];
      map[asset.request_id].push(asset);
    }
    return map;
  }, [assets]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan and track your content across platforms
          </p>
        </div>
        <CreateSlotDialog requests={requests} />
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily" className="gap-1.5">
            <Film className="h-3.5 w-3.5" />
            Daily
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-1.5">
            <List className="h-3.5 w-3.5" />
            List
          </TabsTrigger>
          <TabsTrigger value="week" className="gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Week
          </TabsTrigger>
        </TabsList>

        {/* Daily view with video thumbnails */}
        <TabsContent value="daily">
          <div className="mb-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {formatDateHeading(selectedDay)}
                {" — "}
                {selectedDay.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {dayOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setDayOffset(0)}
                >
                  Today
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDayOffset((o) => o + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {dailySlots.length === 0 ? (
            <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
              <div className="rounded-xl bg-primary/10 p-3">
                <CalendarPlus className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 text-sm font-medium">
                No posts for {formatDateHeading(selectedDay).toLowerCase()}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Schedule content to see it here with video previews.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {dailySlots.map((slot) => {
                const linkedRequest = requests.find(
                  (r) => r.id === slot.request_id
                );
                const slotAssets = slot.request_id
                  ? assetsByRequest[slot.request_id] ?? []
                  : [];
                const editedAsset = slotAssets.find(
                  (a) => a.stage === "edited" || a.stage === "final"
                );
                const isVideo = editedAsset?.mime_type?.startsWith("video/");
                const isImage = editedAsset?.mime_type?.startsWith("image/");
                const time = new Date(slot.scheduled_for).toLocaleTimeString(
                  "en-US",
                  { hour: "numeric", minute: "2-digit", hour12: true }
                );

                return (
                  <div
                    key={slot.id}
                    className="overflow-hidden rounded-xl border border-border/50 bg-card"
                  >
                    {editedAsset && (
                      <div className={`relative w-full bg-black ${isVideo ? "aspect-[9/16] max-h-[70vh]" : "aspect-video"}`}>
                        {isVideo ? (
                          <video
                            controls
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-contain"
                          >
                            <source
                              src={editedAsset.signedUrl}
                              type={editedAsset.mime_type === "video/quicktime" ? "video/mp4" : (editedAsset.mime_type ?? "video/mp4")}
                            />
                          </video>
                        ) : isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={editedAsset.signedUrl}
                            alt={editedAsset.file_name}
                            className="h-full w-full object-contain"
                          />
                        ) : null}
                      </div>
                    )}

                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${PLATFORM_COLORS[slot.platform] ?? PLATFORM_COLORS.other}`}
                        />
                        <span className="text-xs font-medium capitalize text-muted-foreground">
                          {slot.platform}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {time}
                        </div>
                        <Badge
                          variant="outline"
                          className={`ml-auto capitalize ${STATUS_STYLES[slot.status] ?? ""}`}
                        >
                          {slot.status}
                        </Badge>
                      </div>

                      {linkedRequest && (
                        <p className="mt-2 text-sm font-medium">
                          {linkedRequest.title}
                        </p>
                      )}

                      {slot.caption && (
                        <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-wrap">
                          {slot.caption}
                        </p>
                      )}

                      {!editedAsset && !slot.caption && (
                        <p className="mt-2 text-xs italic text-muted-foreground/60">
                          No edited content or caption yet
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* List view */}
        <TabsContent value="list">
          {groupedByDate.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6">
              {groupedByDate.map(([dateKey, daySlots]) => {
                const date = new Date(dateKey + "T00:00:00");
                return (
                  <div key={dateKey}>
                    <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                      {formatDateHeading(date)}
                    </h2>
                    <div className="space-y-2">
                      {daySlots.map((slot) => (
                        <SlotCard
                          key={slot.id}
                          slot={slot}
                          requests={requests}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Week view */}
        <TabsContent value="week">
          <div className="mb-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{weekLabel}</span>
              {weekOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setWeekOffset(0)}
                >
                  Today
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset((o) => o + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, new Date());
              const daySlots = slotsByWeekDay[i];
              return (
                <div key={i} className="min-h-[160px]">
                  <div
                    className={`mb-2 rounded-lg px-2 py-1.5 text-center text-xs font-medium ${
                      isToday
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    <div>{DAY_NAMES[i]}</div>
                    <div
                      className={`mt-0.5 text-lg font-semibold ${
                        isToday ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {daySlots.map((slot) => (
                      <SlotCard
                        key={slot.id}
                        slot={slot}
                        requests={requests}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
      <div className="rounded-xl bg-primary/10 p-3">
        <CalendarPlus className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-sm font-medium">No slots scheduled</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first schedule slot to start planning content.
      </p>
    </div>
  );
}
