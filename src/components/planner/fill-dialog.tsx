"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fillSlots } from "@/app/(app)/planner/[accountId]/actions";
import type { PlannerCut, PlannerPost } from "@/components/planner/planner-view";
import { SAME_REEL_GAP_MS, whenLabel } from "@/components/planner/planner-utils";

export type FillItem = { cut: PlannerCut; at: Date };

/**
 * Free times → unused takes. The reels that did best anywhere go first
 * (newest first among equals), and a reel waits two days between its
 * takes on this account, so the free times rotate through the best reels
 * instead of posting one reel's takes back to back.
 */
export function planFill({
  slots,
  cuts,
  posts,
  plannedCuts,
}: {
  slots: Date[];
  cuts: PlannerCut[];
  posts: PlannerPost[];
  plannedCuts: Set<string | null>;
}): FillItem[] {
  const free = cuts.filter((c) => c.usedOn.length === 0 && !c.queued && !plannedCuts.has(c.id));
  const byReel = new Map<string, PlannerCut[]>();
  for (const c of free) byReel.set(c.requestId, [...(byReel.get(c.requestId) ?? []), c]);
  const reels = Array.from(byReel, ([id, takes]) => ({
    id,
    // Oldest upload first: cut 1 before cut 2.
    takes: [...takes].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
    lift: takes[0].lift ?? 0,
    newest: takes.reduce((m, t) => (t.uploadedAt > m ? t.uploadedAt : m), ""),
  })).sort((a, b) => b.lift - a.lift || b.newest.localeCompare(a.newest));

  const timesOf = new Map<string, number[]>();
  for (const p of posts) {
    if (!p.requestId || p.publishState === "failed") continue;
    timesOf.set(p.requestId, [...(timesOf.get(p.requestId) ?? []), new Date(p.at).getTime()]);
  }

  const out: FillItem[] = [];
  for (const slot of [...slots].sort((a, b) => a.getTime() - b.getTime())) {
    const t = slot.getTime();
    const reel = reels.find(
      (r) => r.takes.length > 0 && (timesOf.get(r.id) ?? []).every((x) => Math.abs(x - t) >= SAME_REEL_GAP_MS)
    );
    if (!reel) continue;
    out.push({ cut: reel.takes.shift()!, at: slot });
    timesOf.set(reel.id, [...(timesOf.get(reel.id) ?? []), t]);
  }
  return out;
}

export function FillDialog({
  accountId,
  items,
  tz,
  lastCaption,
  onClose,
  onChanged,
}: {
  accountId: string;
  items: FillItem[] | null;
  tz: string;
  lastCaption: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<FillItem[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, start] = useTransition();
  useEffect(() => {
    if (!items) return;
    setList(items);
    setCaption(lastCaption ?? "");
  }, [items, lastCaption]);
  if (!items) return null;

  const plan = () =>
    start(async () => {
      const res = await fillSlots(
        accountId,
        list.map((i) => ({ assetId: i.cut.id, at: i.at.toISOString() })),
        caption
      );
      if (res.error) return void toast.error(res.error);
      toast.success(`${res.count} post${res.count === 1 ? "" : "s"} planned`);
      onChanged();
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="border-b border-border/50 px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Fill free times
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Best-performing reels first, two days between takes of one reel. Take out what you do not want.
          </p>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto p-4">
          {list.map((it, i) => (
            <div key={`${it.cut.id}-${it.at.getTime()}`} className="flex items-center gap-3 rounded-lg border border-border/40 p-1.5">
              <div className="h-14 w-8 shrink-0 overflow-hidden rounded bg-black">
                {it.cut.thumb ? (
                  <img src={it.cut.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video src={`${it.cut.video}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{whenLabel(it.at, tz)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {it.cut.title}
                  {it.cut.variant && ` · cut ${it.cut.variant}`}
                </p>
              </div>
              {it.cut.lift != null && (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    it.cut.lift >= 2 ? "bg-emerald-500/20 text-emerald-300" : "bg-muted text-muted-foreground"
                  }`}
                  title="Best plays against its account's usual reach"
                >
                  {it.cut.lift.toFixed(1)}×
                </span>
              )}
              <button
                type="button"
                onClick={() => setList((l) => l.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                title="Leave this one out"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-border/50 p-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Caption for all of them (change single ones later)</span>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className="resize-none text-sm" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={plan} disabled={busy || list.length === 0}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Plan {list.length} post{list.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
