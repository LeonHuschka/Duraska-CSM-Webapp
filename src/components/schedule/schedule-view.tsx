"use client";

import { useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type {
  ScheduleSlot,
  ContentRequest,
  PostingTimeslot,
} from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlotCard } from "@/components/schedule/slot-card";
import { TimeslotSettings } from "@/components/schedule/timeslot-settings";
import {
  CalendarDays,
  List,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  Clock,
  Film,
  GripVertical,
  Settings2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  scheduleRequestToSlot,
  unscheduleSlot,
  seedDefaultTimeslots,
} from "@/app/(app)/schedule/actions";

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
  timeslots: PostingTimeslot[];
  editedRequests: Pick<
    ContentRequest,
    "id" | "title" | "status" | "priority" | "content_type_id" | "is_nsfw"
  >[];
}

// Timezone helpers
const TIMEZONE_OPTIONS = [
  { label: "PST (UTC-8)", offset: -8 },
  { label: "MST (UTC-7)", offset: -7 },
  { label: "CST (UTC-6)", offset: -6 },
  { label: "EST (UTC-5)", offset: -5 },
  { label: "UTC", offset: 0 },
  { label: "CET (UTC+1)", offset: 1 },
  { label: "CEST (UTC+2)", offset: 2 },
  { label: "Local", offset: -(new Date().getTimezoneOffset() / 60) },
];

function utcTimeToLocal(utcTime: string, offsetHours: number, use12h = false): string {
  const [h, m] = utcTime.split(":").map(Number);
  let localH = h + offsetHours;
  if (localH < 0) localH += 24;
  if (localH >= 24) localH -= 24;

  if (use12h) {
    const period = localH >= 12 ? "PM" : "AM";
    const h12 = localH === 0 ? 12 : localH > 12 ? localH - 12 : localH;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  return `${String(localH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function localTimeToUtcISO(
  date: Date,
  utcTime: string
): string {
  const [h, m] = utcTime.split(":").map(Number);
  const d = new Date(date);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
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

// Draggable request card
function DraggableRequest({
  request,
  isDragging,
}: {
  request: Pick<ContentRequest, "id" | "title" | "status" | "priority" | "content_type_id" | "is_nsfw">;
  isDragging?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs transition-all ${
        request.is_nsfw
          ? "border-blue-500/40 bg-blue-500/5"
          : "border-border/50 bg-card"
      } ${
        isDragging ? "opacity-50" : "cursor-grab hover:border-border hover:bg-accent/30"
      }`}
      data-request-id={request.id}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <span className="font-medium truncate flex-1">{request.title}</span>
      {request.is_nsfw ? (
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 bg-blue-500/15 text-blue-400 border-blue-500/30">
          NSFW
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 bg-green-500/15 text-green-400 border-green-500/30">
          SFW
        </Badge>
      )}
    </div>
  );
}

// Droppable timeslot — vertical column card
function DroppableTimeslot({
  id,
  timeLabel,
  slot,
  linkedRequest,
  asset,
  platform,
  onUnschedule,
}: {
  id: string;
  timeLabel: string;
  slot: ScheduleSlot | null;
  linkedRequest: Pick<ContentRequest, "id" | "title" | "status"> | null;
  asset: ScheduleAsset | null;
  platform: string;
  onUnschedule: (slotId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isVideo = asset?.mime_type?.startsWith("video/");
  const isImage = asset?.mime_type?.startsWith("image/");

  return (
    <div
      ref={setNodeRef}
      className={`flex w-52 min-w-[208px] shrink-0 flex-col rounded-xl border transition-all duration-200 ${
        slot
          ? "border-border/50 bg-card"
          : isOver
            ? "border-primary/50 bg-primary/5 border-dashed"
            : "border-border/30 bg-muted/20 border-dashed"
      }`}
    >
      {/* Time header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm font-semibold">{timeLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[platform] ?? PLATFORM_COLORS.other}`}
          />
          {slot && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={() => onUnschedule(slot.id)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {slot && linkedRequest ? (
        <div className="flex flex-col p-2">
          {asset && (
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
              {isVideo ? (
                <video
                  key={asset.id}
                  controls
                  playsInline
                  preload="metadata"
                  src={`${asset.signedUrl}#t=0.001`}
                  className="h-full w-full object-contain"
                />
              ) : isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.signedUrl}
                  alt={asset.file_name}
                  className="h-full w-full object-contain"
                />
              ) : null}
            </div>
          )}
          <p className="mt-2 text-xs font-medium truncate px-0.5">{linkedRequest.title}</p>
          {slot.caption && (
            <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2 whitespace-pre-wrap px-0.5">
              {slot.caption}
            </p>
          )}
          {asset && (
            <a
              href={asset.signedUrl}
              download={asset.file_name}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              Download
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center py-12 px-3">
          <p className="text-[11px] text-muted-foreground/50 text-center">
            {isOver ? "Drop here" : "Drag request here"}
          </p>
        </div>
      )}
    </div>
  );
}

export function ScheduleView({
  slots,
  requests,
  assets = [],
  timeslots,
  editedRequests,
}: ScheduleViewProps) {
  const router = useRouter();
  const [dayOffset, setDayOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [use12h, setUse12h] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  // Detect local timezone offset
  const localOffset = -(new Date().getTimezoneOffset() / 60);
  const [tzOffset, setTzOffset] = useState<number>(localOffset);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const selectedDay = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);

  // Unique platforms from defined timeslots
  const availablePlatforms = useMemo(() => {
    const set = new Set(timeslots.map((ts) => ts.platform));
    return Array.from(set).sort();
  }, [timeslots]);

  // Map timeslots to display times, apply platform filter
  const dailyTimeslots = useMemo(() => {
    return timeslots
      .filter((ts) => platformFilter === "all" || ts.platform === platformFilter)
      .map((ts) => {
        // Always sort by 24h key so order is stable
        const sortKey = utcTimeToLocal(ts.time_utc, tzOffset, false);
        const displayTime = utcTimeToLocal(ts.time_utc, tzOffset, use12h);
        return { ...ts, displayTime, sortKey };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [timeslots, tzOffset, use12h, platformFilter]);

  // Find existing slots for the selected day
  const slotsByTimeslot = useMemo(() => {
    const map: Record<string, ScheduleSlot> = {};
    for (const slot of slots) {
      const d = new Date(slot.scheduled_for);
      if (isSameDay(d, selectedDay)) {
        // Match by UTC hour:minute
        const utcKey = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        for (const ts of timeslots) {
          const tsKey = ts.time_utc.slice(0, 5);
          if (utcKey === tsKey) {
            map[ts.id] = slot;
          }
        }
      }
    }
    return map;
  }, [slots, selectedDay, timeslots]);

  const assetsByRequest = useMemo(() => {
    const map: Record<string, ScheduleAsset> = {};
    for (const asset of assets) {
      if (!map[asset.request_id]) map[asset.request_id] = asset;
    }
    return map;
  }, [assets]);

  // Filter out already-scheduled requests
  const availableRequests = useMemo(() => {
    const scheduledIds = new Set(
      Object.values(slotsByTimeslot)
        .map((s) => s.request_id)
        .filter(Boolean)
    );
    return editedRequests.filter((r) => !scheduledIds.has(r.id));
  }, [editedRequests, slotsByTimeslot]);

  const activeRequest = useMemo(
    () => editedRequests.find((r) => r.id === activeRequestId) ?? null,
    [editedRequests, activeRequestId]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveRequestId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveRequestId(null);
      const { active, over } = event;
      if (!over) return;

      const requestId = active.id as string;
      const timeslotId = over.id as string;
      const timeslot = timeslots.find((ts) => ts.id === timeslotId);
      if (!timeslot) return;

      // Already has a slot?
      if (slotsByTimeslot[timeslotId]) return;

      const scheduledFor = localTimeToUtcISO(selectedDay, timeslot.time_utc);

      (async () => {
        try {
          const result = await scheduleRequestToSlot({
            request_id: requestId,
            scheduled_for: scheduledFor,
            platform: timeslot.platform,
          });
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success("Scheduled!");
            router.refresh();
          }
        } catch {
          toast.error("Failed to schedule");
        }
      })();
    },
    [timeslots, slotsByTimeslot, selectedDay, router]
  );

  const handleUnschedule = useCallback(
    (slotId: string) => {
      (async () => {
        try {
          const result = await unscheduleSlot(slotId);
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success("Unscheduled");
            router.refresh();
          }
        } catch {
          toast.error("Failed to unschedule");
        }
      })();
    },
    [router]
  );

  const handleSeedDefaults = useCallback(async () => {
    try {
      await seedDefaultTimeslots();
      toast.success("Default timeslots created");
      router.refresh();
    } catch {
      toast.error("Failed to create defaults");
    }
  }, [router]);

  // Week view helpers
  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset]
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${weekStart.toLocaleDateString("en-US", opts)} - ${end.toLocaleDateString("en-US", opts)}, ${end.getFullYear()}`;
  }, [weekStart]);
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

  // List view
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan and track your content across platforms
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs font-mono"
            onClick={() => setUse12h((v) => !v)}
          >
            {use12h ? "12h" : "24h"}
          </Button>
          <Select
            value={String(tzOffset)}
            onValueChange={(v) => setTzOffset(Number(v))}
          >
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.label} value={String(tz.offset)}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Timeslots
          </Button>
        </div>
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

        {/* DAILY VIEW with DnD */}
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

          {/* Platform filter */}
          {availablePlatforms.length > 1 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Platform</span>
              <div className="flex gap-1">
                <Button
                  variant={platformFilter === "all" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPlatformFilter("all")}
                >
                  All
                </Button>
                {availablePlatforms.map((p) => (
                  <Button
                    key={p}
                    variant={platformFilter === p ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs gap-1.5"
                    onClick={() => setPlatformFilter(p)}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[p] ?? PLATFORM_COLORS.other}`}
                    />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {timeslots.length === 0 ? (
            <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
              <div className="rounded-xl bg-primary/10 p-3">
                <CalendarPlus className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 text-sm font-medium">
                No posting timeslots configured
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Set up your daily posting schedule first.
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={handleSeedDefaults}
              >
                Add default timeslots (5x daily)
              </Button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4">
                {/* Left panel: available edited requests */}
                <div className="w-56 shrink-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Ready to schedule
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {availableRequests.length}
                    </Badge>
                  </div>

                  {availableRequests.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/30 p-4 text-center">
                      <p className="text-[11px] text-muted-foreground/60">
                        No edited requests available
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                      {availableRequests.map((req) => (
                        <DraggableRequestWrapper key={req.id} request={req} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Right panel: Timeslot columns left to right, wrapping to new rows */}
                <div className="flex flex-1 flex-wrap gap-3 pb-4">
                  {dailyTimeslots.map((ts) => {
                    const slot = slotsByTimeslot[ts.id] ?? null;
                    const linkedRequest = slot?.request_id
                      ? requests.find((r) => r.id === slot.request_id) ?? null
                      : null;
                    const asset = slot?.request_id
                      ? assetsByRequest[slot.request_id] ?? null
                      : null;

                    return (
                      <DroppableTimeslot
                        key={ts.id}
                        id={ts.id}
                        timeLabel={ts.displayTime}
                        slot={slot}
                        linkedRequest={linkedRequest}
                        asset={asset}
                        platform={ts.platform}
                        onUnschedule={handleUnschedule}
                      />
                    );
                  })}
                </div>
              </div>

              <DragOverlay>
                {activeRequest ? (
                  <div className="w-56 rotate-2 scale-105">
                    <DraggableRequest request={activeRequest} isDragging />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </TabsContent>

        {/* LIST VIEW */}
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

        {/* WEEK VIEW */}
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

      {/* Timeslot settings dialog */}
      <TimeslotSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        timeslots={timeslots}
        tzOffset={tzOffset}
      />
    </div>
  );
}

// Wrapper to make requests draggable with useDraggable
function DraggableRequestWrapper({
  request,
}: {
  request: Pick<ContentRequest, "id" | "title" | "status" | "priority" | "content_type_id" | "is_nsfw">;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: request.id,
  });

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <DraggableRequest request={request} isDragging={isDragging} />
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
