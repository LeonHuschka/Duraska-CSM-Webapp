"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  X,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  saveSlotMedia,
  clearSlotMedia,
  saveSlotText,
  setSlotPosted,
  setSlotSkipped,
  setWarmupDay,
} from "@/app/(app)/warmup/actions";
import { createClient } from "@/lib/supabase/client";
import { generateThumbnail, thumbnailPathFor } from "@/lib/thumbnails";
import {
  ASSET_KIND_LABEL,
  ASSET_KIND_EMOJI,
  WARMUP_DURATION_DAYS,
  phaseForDay,
  dailyTargetSummary,
  type AssetKind,
} from "@/lib/warmup-spec";
import type { Account } from "@/lib/types/database";
import type { WarmupSlotView } from "@/app/(app)/warmup/[id]/page";

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

export function WarmupAccountView({
  account,
  slots,
  personaId,
  currentDay,
}: {
  account: Account;
  slots: WarmupSlotView[];
  personaId: string;
  currentDay: number;
}) {
  const router = useRouter();
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [savingDay, setSavingDay] = useState(false);
  const [dayInput, setDayInput] = useState(String(currentDay));
  useEffect(() => {
    setDayInput(String(currentDay));
  }, [currentDay]);

  // Group slots by day
  const byDay = useMemo(() => {
    const m: Record<number, WarmupSlotView[]> = {};
    for (const s of slots) (m[s.day_number] ??= []).push(s);
    return m;
  }, [slots]);

  // Which days are expanded. Default: current day + any earlier day with
  // unfinished work.
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const set = new Set<number>();
    set.add(currentDay);
    for (let d = 1; d < currentDay; d++) {
      const hasOpen = (byDayInitial(slots, d)).some(
        (s) => s.status !== "posted" && s.status !== "skipped"
      );
      if (hasOpen) set.add(d);
    }
    return set;
  });

  function toggleDay(d: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const totalPosted = slots.filter((s) => s.status === "posted").length;
  const totalSlots = slots.length;
  const pct = totalSlots > 0 ? Math.round((totalPosted / totalSlots) * 100) : 0;

  // Upload a dragged/picked file directly into a slot. Stored under
  // personas/{personaId}/warmup/... so the existing storage RLS applies.
  async function doUpload(slot: WarmupSlotView, file: File) {
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      toast.error("Only images and videos");
      return;
    }
    setBusySlot(slot.id);
    try {
      const supabase = createClient();
      const uuid = crypto.randomUUID();
      const filePath = `personas/${personaId}/warmup/${account.id}/${slot.id}/${uuid}_${file.name}`;

      const { error: upErr } = await supabase.storage
        .from("content-assets")
        .upload(filePath, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);

      // Thumbnail (non-fatal)
      let thumbnailPath: string | null = null;
      try {
        const thumb = await generateThumbnail(file);
        if (thumb) {
          const tPath = thumbnailPathFor(filePath);
          const { error: tErr } = await supabase.storage
            .from("content-assets")
            .upload(tPath, thumb, { contentType: "image/jpeg", upsert: true });
          if (!tErr) thumbnailPath = tPath;
        }
      } catch (err) {
        console.warn("[warmup] thumbnail failed", err);
      }

      const res = await saveSlotMedia(slot.id, {
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        thumbnail_path: thumbnailPath,
      });
      if (res.error) throw new Error(res.error);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusySlot(null);
    }
  }

  async function doClear(slotId: string) {
    setBusySlot(slotId);
    const res = await clearSlotMedia(slotId);
    setBusySlot(null);
    if (res.error) toast.error(res.error);
    else router.refresh();
  }
  async function doPosted(slotId: string, posted: boolean) {
    setBusySlot(slotId);
    const res = await setSlotPosted(slotId, posted);
    setBusySlot(null);
    if (res.error) toast.error(res.error);
    else router.refresh();
  }
  async function doSkip(slotId: string, skipped: boolean) {
    setBusySlot(slotId);
    const res = await setSlotSkipped(slotId, skipped);
    setBusySlot(null);
    if (res.error) toast.error(res.error);
    else router.refresh();
  }

  async function changeDay(next: number) {
    const clamped = Math.max(1, Math.min(WARMUP_DURATION_DAYS, next));
    if (clamped === currentDay) {
      setDayInput(String(currentDay));
      return;
    }
    setSavingDay(true);
    setDayInput(String(clamped));
    const res = await setWarmupDay(account.id, clamped);
    setSavingDay(false);
    if (res.error) {
      toast.error(res.error);
      setDayInput(String(currentDay));
    } else {
      router.refresh();
    }
  }

  function commitDayInput() {
    const parsed = parseInt(dayInput, 10);
    if (Number.isNaN(parsed)) {
      setDayInput(String(currentDay));
      return;
    }
    changeDay(parsed);
  }

  const days = Array.from({ length: WARMUP_DURATION_DAYS }, (_, i) => i + 1);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/warmup"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All accounts
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              @{account.handle}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {PLATFORM_LABEL[account.platform] ?? account.platform}
              {account.display_name ? ` · ${account.display_name}` : ""}
            </p>
          </div>

          {/* Manual current-day control */}
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Day</span>
            <button
              onClick={() => changeDay(currentDay - 1)}
              disabled={savingDay || currentDay <= 1}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-accent/40 disabled:opacity-40"
              aria-label="Previous day"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="number"
              min={1}
              max={WARMUP_DURATION_DAYS}
              value={dayInput}
              onChange={(e) => setDayInput(e.target.value)}
              onBlur={() => commitDayInput()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              disabled={savingDay}
              className="w-10 rounded-md border border-border/50 bg-background px-1 py-0.5 text-center text-sm tabular-nums outline-none focus:border-primary/60"
            />
            <button
              onClick={() => changeDay(currentDay + 1)}
              disabled={savingDay || currentDay >= WARMUP_DURATION_DAYS}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-accent/40 disabled:opacity-40"
              aria-label="Next day"
            >
              <Plus className="h-3 w-3" />
            </button>
            <span className="text-[11px] text-muted-foreground">/ {WARMUP_DURATION_DAYS}</span>
            {savingDay && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* Overall progress */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Overall warm-up progress</span>
            <span>{totalPosted}/{totalSlots} posted ({pct}%)</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Day-by-day plan */}
      <div className="space-y-2">
        {days.map((day) => {
          const daySlots = byDay[day] ?? [];
          const posted = daySlots.filter((s) => s.status === "posted").length;
          const done = daySlots.length > 0 && daySlots.every(
            (s) => s.status === "posted" || s.status === "skipped"
          );
          const isToday = day === currentDay;
          const isPast = day < currentDay;
          const hasOpen = daySlots.some(
            (s) => s.status !== "posted" && s.status !== "skipped"
          );
          const isExpanded = expanded.has(day);

          return (
            <div
              key={day}
              className={`rounded-xl border transition-colors ${
                isToday
                  ? "border-amber-500/50 bg-amber-500/[0.03]"
                  : isPast && hasOpen
                    ? "border-red-500/30"
                    : "border-border/40"
              }`}
            >
              <button
                onClick={() => toggleDay(day)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Day {day}</span>
                    {isToday && (
                      <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                        Today
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {phaseForDay(day)}
                    </span>
                  </div>
                  <span className="truncate text-[11px] text-muted-foreground/70">
                    {dailyTargetSummary(day)}
                  </span>
                </div>
                {daySlots.length > 0 ? (
                  done ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-green-400">
                      <Check className="h-3.5 w-3.5" /> Done
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {posted}/{daySlots.length}
                    </span>
                  )
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground/50">—</span>
                )}
              </button>

              {isExpanded && (
                <div className="space-y-2 border-t border-border/30 px-4 py-3">
                  {daySlots.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/60">
                      {day === 1
                        ? "Just create the account and browse — no content needed."
                        : "No slots."}
                    </p>
                  ) : (
                    daySlots.map((slot) => (
                      <SlotRow
                        key={slot.id}
                        slot={slot}
                        busy={busySlot === slot.id}
                        onUpload={(file) => doUpload(slot, file)}
                        onClear={() => doClear(slot.id)}
                        onPosted={(p) => doPosted(slot.id, p)}
                        onSkip={(s) => doSkip(slot.id, s)}
                        onSaveText={async (txt) => {
                          setBusySlot(slot.id);
                          const res = await saveSlotText(slot.id, txt);
                          setBusySlot(null);
                          if (res.error) toast.error(res.error);
                          else router.refresh();
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper used only for initial-expand computation
function byDayInitial(slots: WarmupSlotView[], day: number) {
  return slots.filter((s) => s.day_number === day);
}

function SlotRow({
  slot,
  busy,
  onUpload,
  onClear,
  onPosted,
  onSkip,
  onSaveText,
}: {
  slot: WarmupSlotView;
  busy: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
  onPosted: (posted: boolean) => void;
  onSkip: (skipped: boolean) => void;
  onSaveText: (txt: string) => void;
}) {
  const kind = slot.asset_kind as AssetKind;
  const isBio = kind === "bio";
  const isPosted = slot.status === "posted";
  const isSkipped = slot.status === "skipped";
  const [bioText, setBioText] = useState(slot.text_content ?? "");
  const isVideo = slot.mime_type?.startsWith("video/");
  const hasMedia = !!slot.file_path;
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
        isPosted
          ? "border-green-500/30 bg-green-500/[0.04]"
          : isSkipped
            ? "border-border/30 bg-muted/20 opacity-60"
            : "border-border/40 bg-card"
      }`}
    >
      {/* Thumbnail / kind icon */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
        {slot.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slot.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : slot.signedUrl && !isVideo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slot.signedUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-lg">{ASSET_KIND_EMOJI[kind]}</span>
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{ASSET_KIND_LABEL[kind]}</span>
          {isPosted && (
            <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-400">
              Posted
            </span>
          )}
          {isSkipped && (
            <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">
              Skipped
            </span>
          )}
        </div>
        {slot.notes && (
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            {slot.notes}
          </p>
        )}

        {isBio ? (
          <div className="mt-2 space-y-1.5">
            <Textarea
              value={bioText}
              onChange={(e) => setBioText(e.target.value)}
              placeholder="Write the bio (short, natural, no links in week 1)…"
              className="min-h-[60px] text-xs"
              disabled={busy || isPosted}
            />
            {!isPosted && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => onSaveText(bioText)}
                disabled={busy}
              >
                Save bio
              </Button>
            )}
          </div>
        ) : hasMedia ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="truncate text-[11px] text-muted-foreground max-w-[180px]">
              {slot.file_name ?? "media attached"}
            </span>
            {!isPosted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px] text-muted-foreground"
                onClick={onClear}
                disabled={busy}
              >
                <X className="h-3 w-3" /> Remove
              </Button>
            )}
          </div>
        ) : (
          !isPosted &&
          !isSkipped && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) onUpload(f);
              }}
              className={`mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-2 text-[11px] transition-colors ${
                dragOver
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-primary/40 hover:bg-accent/20"
              } ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <Upload className="h-3.5 w-3.5" />
              {busy ? "Uploading…" : "Drag file here or click to upload"}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*,.mov,.MOV"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
            </div>
          )
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <button
              onClick={() => onPosted(!isPosted)}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                isPosted
                  ? "bg-green-500/20 text-green-400"
                  : "bg-primary/10 text-primary hover:bg-primary/20"
              }`}
            >
              <Check className="h-3 w-3" />
              {isPosted ? "Posted" : "Mark posted"}
            </button>
            {!isPosted && (
              <button
                onClick={() => onSkip(!isSkipped)}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
              >
                {isSkipped ? "Un-skip" : "Skip"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
