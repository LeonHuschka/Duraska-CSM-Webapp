"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Plus,
  X,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  attachAssetToSlot,
  detachAssetFromSlot,
  saveSlotText,
  setSlotPosted,
  setSlotSkipped,
  updateAccount,
} from "@/app/(app)/warmup/actions";
import {
  ASSET_KIND_LABEL,
  ASSET_KIND_EMOJI,
  WARMUP_DURATION_DAYS,
  phaseForDay,
  dailyTargetSummary,
  type AssetKind,
} from "@/lib/warmup-spec";
import type { Account } from "@/lib/types/database";
import type { WarmupSlotView, PoolAsset } from "@/app/(app)/warmup/[id]/page";

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

export function WarmupAccountView({
  account,
  slots,
  pool,
  currentDay,
}: {
  account: Account;
  slots: WarmupSlotView[];
  pool: PoolAsset[];
  currentDay: number;
}) {
  const router = useRouter();
  const [pickerSlot, setPickerSlot] = useState<WarmupSlotView | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [graduating, setGraduating] = useState(false);

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

  async function doAttach(slotId: string, assetId: string) {
    setBusySlot(slotId);
    const res = await attachAssetToSlot(slotId, assetId);
    setBusySlot(null);
    if (res.error) toast.error(res.error);
    else {
      setPickerSlot(null);
      router.refresh();
    }
  }
  async function doDetach(slotId: string) {
    setBusySlot(slotId);
    const res = await detachAssetFromSlot(slotId);
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

  async function doGraduate() {
    setGraduating(true);
    const res = await updateAccount(account.id, { status: "graduated" });
    setGraduating(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success(`@${account.handle} graduated to the rotation 🎉`);
      router.refresh();
    }
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
              {account.display_name ? ` · ${account.display_name}` : ""} · Day{" "}
              {currentDay} / {WARMUP_DURATION_DAYS}
            </p>
          </div>
          {account.status === "warmup" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-green-500/40 text-green-400 hover:bg-green-500/10"
              onClick={doGraduate}
              disabled={graduating}
            >
              {graduating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GraduationCap className="h-4 w-4" />
              )}
              Graduate to rotation
            </Button>
          )}
          {account.status === "graduated" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-400">
              <GraduationCap className="h-3.5 w-3.5" /> Graduated
            </span>
          )}
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
                        onPick={() => setPickerSlot(slot)}
                        onDetach={() => doDetach(slot.id)}
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

      {/* Asset picker dialog */}
      <Dialog open={!!pickerSlot} onOpenChange={(o) => !o && setPickerSlot(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pick content for{" "}
              {pickerSlot ? ASSET_KIND_LABEL[pickerSlot.asset_kind as AssetKind] : ""}
            </DialogTitle>
          </DialogHeader>
          {pool.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <ImageOff className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No warm-up content in the pool yet.
              </p>
              <p className="text-[11px] text-muted-foreground/60">
                Upload content via the Vault and toggle &quot;Warm-up&quot;, or move
                existing content into the warm-up pool.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {pool.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pickerSlot && doAttach(pickerSlot.id, p.id)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border/40 bg-muted/30 transition-all hover:border-primary/60"
                  title={p.request_title}
                >
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnailUrl}
                      alt={p.request_title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-black">
                      <span className="text-2xl">🎬</span>
                    </div>
                  )}
                  {p.usedCount > 0 && (
                    <span
                      className="absolute right-1 top-1 rounded bg-red-500/90 px-1 py-0.5 text-[8px] font-bold text-white"
                      title={`Already used in ${p.usedCount} warm-up slot(s) — 1 image = 1 post`}
                    >
                      used ×{p.usedCount}
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                    <p className="truncate text-[8px] text-white/80">{p.request_title}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
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
  onPick,
  onDetach,
  onPosted,
  onSkip,
  onSaveText,
}: {
  slot: WarmupSlotView;
  busy: boolean;
  onPick: () => void;
  onDetach: () => void;
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
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {slot.asset_id ? (
              !isPosted && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-[11px] text-muted-foreground"
                  onClick={onDetach}
                  disabled={busy}
                >
                  <X className="h-3 w-3" /> Remove content
                </Button>
              )
            ) : (
              !isPosted &&
              !isSkipped && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[11px]"
                  onClick={onPick}
                  disabled={busy}
                >
                  <Plus className="h-3 w-3" /> Attach content
                </Button>
              )
            )}
          </div>
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
