"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Clock, Plus, Trash2 } from "lucide-react";
import type { PostingTimeslot } from "@/lib/types/database";
import {
  addTimeslot,
  removeTimeslot,
  updateTimeslot,
} from "@/app/(app)/schedule/actions";

interface TimeslotSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeslots: PostingTimeslot[];
  tzOffset: number;
}

function utcTimeToLocal(utcTime: string, offsetHours: number): string {
  const [h, m] = utcTime.split(":").map(Number);
  let localH = h + offsetHours;
  if (localH < 0) localH += 24;
  if (localH >= 24) localH -= 24;
  return `${String(localH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function localTimeToUtc(localTime: string, offsetHours: number): string {
  const [h, m] = localTime.split(":").map(Number);
  let utcH = h - offsetHours;
  if (utcH < 0) utcH += 24;
  if (utcH >= 24) utcH -= 24;
  return `${String(utcH).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

const PLATFORM_OPTIONS = [
  { value: "fansly", label: "Fansly" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "other", label: "Other" },
];

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500",
  fansly: "bg-blue-500",
  tiktok: "bg-slate-600",
  other: "bg-gray-500",
};

export function TimeslotSettings({
  open,
  onOpenChange,
  timeslots,
  tzOffset,
}: TimeslotSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // New timeslot form state
  const [newTime, setNewTime] = useState("12:00");
  const [newLabel, setNewLabel] = useState("");
  const [newPlatform, setNewPlatform] = useState("fansly");

  const sortedTimeslots = [...timeslots].sort((a, b) => {
    const aLocal = utcTimeToLocal(a.time_utc, tzOffset);
    const bLocal = utcTimeToLocal(b.time_utc, tzOffset);
    return aLocal.localeCompare(bLocal);
  });

  const handleAdd = () => {
    if (!newTime) return;
    const utcTime = localTimeToUtc(newTime, tzOffset);

    startTransition(async () => {
      try {
        await addTimeslot(utcTime, newLabel || undefined, newPlatform);
        toast.success("Timeslot added");
        setNewTime("12:00");
        setNewLabel("");
        setNewPlatform("fansly");
        router.refresh();
      } catch {
        toast.error("Failed to add timeslot");
      }
    });
  };

  const handleRemove = (id: string) => {
    startTransition(async () => {
      try {
        await removeTimeslot(id);
        toast.success("Timeslot removed");
        router.refresh();
      } catch {
        toast.error("Failed to remove timeslot");
      }
    });
  };

  const handleUpdateLabel = (id: string, label: string) => {
    startTransition(async () => {
      try {
        await updateTimeslot(id, { label: label || undefined });
        router.refresh();
      } catch {
        toast.error("Failed to update timeslot");
      }
    });
  };

  const handleUpdatePlatform = (id: string, platform: string) => {
    startTransition(async () => {
      try {
        await updateTimeslot(id, { platform });
        router.refresh();
      } catch {
        toast.error("Failed to update timeslot");
      }
    });
  };

  const handleUpdateTime = (id: string, localTime: string) => {
    const utcTime = localTimeToUtc(localTime, tzOffset);
    startTransition(async () => {
      try {
        await updateTimeslot(id, { time_utc: utcTime });
        router.refresh();
      } catch {
        toast.error("Failed to update timeslot");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Posting Timeslots
          </DialogTitle>
          <DialogDescription>
            Configure your daily posting times. Times are displayed in your
            selected timezone.
          </DialogDescription>
        </DialogHeader>

        {/* Existing timeslots */}
        <div className="space-y-2">
          {sortedTimeslots.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/30 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No timeslots configured yet.
              </p>
            </div>
          ) : (
            sortedTimeslots.map((ts) => {
              const localTime = utcTimeToLocal(ts.time_utc, tzOffset);
              return (
                <div
                  key={ts.id}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-2.5"
                >
                  {/* Time input */}
                  <Input
                    type="time"
                    defaultValue={localTime}
                    className="w-[100px] h-8 text-xs"
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== localTime) {
                        handleUpdateTime(ts.id, e.target.value);
                      }
                    }}
                  />

                  {/* Label input */}
                  <Input
                    defaultValue={ts.label ?? ""}
                    placeholder="Label"
                    className="flex-1 h-8 text-xs"
                    onBlur={(e) => {
                      if (e.target.value !== (ts.label ?? "")) {
                        handleUpdateLabel(ts.id, e.target.value);
                      }
                    }}
                  />

                  {/* Platform selector */}
                  <Select
                    defaultValue={ts.platform}
                    onValueChange={(v) => handleUpdatePlatform(ts.id, v)}
                  >
                    <SelectTrigger className="w-[110px] h-8 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[ts.platform] ?? PLATFORM_COLORS.other}`}
                        />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[p.value] ?? PLATFORM_COLORS.other}`}
                            />
                            {p.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(ts.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {/* Add new timeslot */}
        <div className="mt-2 space-y-3 rounded-lg border border-dashed border-border/50 p-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Add Timeslot
          </Label>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time</Label>
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-[100px] h-8 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">
                Label (optional)
              </Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Morning Post"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Platform</Label>
              <Select value={newPlatform} onValueChange={setNewPlatform}>
                <SelectTrigger className="w-[110px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[p.value] ?? PLATFORM_COLORS.other}`}
                        />
                        {p.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleAdd}
              disabled={isPending || !newTime}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-1 flex items-start gap-2 rounded-lg bg-muted/30 p-2.5">
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {sortedTimeslots.length} timeslots
          </Badge>
          <p className="text-[11px] text-muted-foreground">
            These timeslots define your daily posting schedule. Each day will
            show these times as drop zones for scheduling content.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
