"use client";

/* eslint-disable @next/next/no-img-element */
import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, Loader2, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { atTime, dayKey } from "@/components/planner/planner-utils";
import { planFanslyPost, removeFanslyPost } from "@/app/(app)/vault/fansly-actions";
import type { VaultAsset } from "@/app/(app)/vault/page";

/**
 * The Fansly planner in the vault: a Fansly cut gets a time, a caption and
 * maybe a price, and goes to the VA's Fansly topic as a task at once. The
 * list on top shows what is planned; a plan taken back leaves the topic too.
 */

export type FanslyPlan = {
  id: string;
  asset_id: string;
  scheduled_for: string;
  caption: string;
  price: number | null;
  note: string | null;
  status: string;
  error: string | null;
};

const TZ = "Europe/Berlin";
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

type Ctx = { open: (asset: VaultAsset) => void; byAsset: Map<string, FanslyPlan[]> };
const PlannerContext = createContext<Ctx | null>(null);

/** Null for anyone who may not plan (VAs, the model). */
export const useFanslyPlanner = () => useContext(PlannerContext);

export function FanslyPlannerProvider({
  enabled,
  plans,
  children,
}: {
  enabled: boolean;
  plans: FanslyPlan[];
  children: ReactNode;
}) {
  const [asset, setAsset] = useState<VaultAsset | null>(null);
  const byAsset = useMemo(() => {
    const m = new Map<string, FanslyPlan[]>();
    for (const p of plans) m.set(p.asset_id, [...(m.get(p.asset_id) ?? []), p]);
    return m;
  }, [plans]);
  const value = useMemo<Ctx>(() => ({ open: setAsset, byAsset }), [byAsset]);
  if (!enabled) return <>{children}</>;
  return (
    <PlannerContext.Provider value={value}>
      {children}
      <PlanDialog asset={asset} onClose={() => setAsset(null)} />
    </PlannerContext.Provider>
  );
}

/** On a Fansly card: the button that plans it, and when it is planned. */
export function FanslyPlanButton({ asset }: { asset: VaultAsset }) {
  const ctx = useFanslyPlanner();
  if (!ctx || asset.stage !== "fansly") return null;
  const planned = ctx.byAsset.get(asset.id)?.length ?? 0;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        ctx.open(asset);
      }}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full text-white",
        planned ? "bg-blue-500/90 hover:bg-blue-500" : "bg-black/50 hover:bg-black/70"
      )}
      title={planned ? `Planned on Fansly ${planned}× — plan again` : "Plan on Fansly"}
    >
      <CalendarClock className="h-3.5 w-3.5" />
    </button>
  );
}

/** The small label on a planned Fansly card. */
export function FanslyPlannedBadge({ assetId }: { assetId: string }) {
  const ctx = useFanslyPlanner();
  const next = ctx?.byAsset.get(assetId)?.slice().sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)).at(-1);
  if (!next) return null;
  return (
    <span className="w-fit rounded-md bg-blue-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
      Fansly · {when(next.scheduled_for)}
    </span>
  );
}

function PlanDialog({ asset, onClose }: { asset: VaultAsset | null; onClose: () => void }) {
  const router = useRouter();
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000), TZ);
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("20:00");
  const [caption, setCaption] = useState("");
  const [ppv, setPpv] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();

  const reset = () => {
    setDate(dayKey(new Date(Date.now() + 86_400_000), TZ));
    setTime("20:00");
    setCaption("");
    setPpv(false);
    setPrice("");
    setNote("");
  };

  const send = () => {
    if (!asset) return;
    const at = date && time ? atTime(date, time, TZ) : new Date(NaN);
    if (Number.isNaN(at.getTime())) return void toast.error("Pick a date and time");
    const amount = ppv ? Number(price.replace(",", ".")) : null;
    if (ppv && !(amount && amount > 0)) return void toast.error("Set the PPV price");
    start(async () => {
      const res = await planFanslyPost({ assetId: asset.id, when: at.toISOString(), caption, price: amount, note });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Sent to the VA");
        reset();
        onClose();
      }
      router.refresh();
    });
  };

  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan on Fansly</DialogTitle>
        </DialogHeader>
        {asset && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-xl bg-black/40">
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video src={asset.signedUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate text-sm font-medium">{asset.request_title}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" />
                </div>
                <p className="text-[11px] text-muted-foreground">Berlin time. The VA sets it in Fansly&apos;s scheduler.</p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">Caption</span>
                <span className="tabular-nums text-muted-foreground">{caption.length}/3000</span>
              </div>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={3000}
                rows={5}
                placeholder="What goes under the post"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="glass-pill flex rounded-full p-1 text-xs">
                {[false, true].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setPpv(v)}
                    className={cn(
                      "rounded-full px-3 py-1 font-medium transition-colors",
                      ppv === v ? "bg-white text-neutral-900" : "text-white/70 hover:text-white"
                    )}
                  >
                    {v ? "PPV" : "Free"}
                  </button>
                ))}
              </div>
              {ppv && (
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="9.99"
                    className="h-9 pl-6"
                  />
                </div>
              )}
            </div>

            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note to the VA (optional)" className="h-9" />

            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? "Sending the video…" : "Send to the VA"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What is planned on Fansly, soonest first — on top of the Fansly view. */
export function FanslyPlanList({ plans, assets }: { plans: FanslyPlan[]; assets: VaultAsset[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [, start] = useTransition();
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const since = Date.now() - 12 * 3600_000;
  const upcoming = plans
    .filter((p) => new Date(p.scheduled_for).getTime() >= since)
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

  const remove = (id: string) => {
    setRemoving(id);
    start(async () => {
      const res = await removeFanslyPost(id);
      if (res.error) toast.error(res.error);
      else toast.success("Taken back, and out of the VA's topic");
      setRemoving(null);
      router.refresh();
    });
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Planned on Fansly</h2>
        <p className="text-[11px] text-white/50">Click the calendar on a cut to plan it</p>
      </div>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-xs text-white/50">Nothing planned yet.</p>
      ) : (
        <ul className="mt-3 flex snap-x gap-3 overflow-x-auto pb-1">
          {upcoming.map((p) => {
            const a = byId.get(p.asset_id);
            return (
              <li
                key={p.id}
                className="flex w-64 shrink-0 snap-start gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-2.5"
              >
                <div className="aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  {a?.thumbnailUrl && <img src={a.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold">{when(p.scheduled_for)}</p>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={removing === p.id}
                      className="-mr-1 -mt-1 rounded-full p-1 text-white/45 hover:text-rose-300"
                      title="Take back"
                    >
                      {removing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-white/60">{p.price ? `PPV $${Number(p.price).toFixed(2)}` : "Free"}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-white/80">{p.caption || <i className="text-white/40">No caption</i>}</p>
                  {p.status === "sent" ? (
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-emerald-300">
                      <Check className="h-3 w-3" /> With the VA
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-rose-300" title={p.error ?? undefined}>
                      <AlertTriangle className="h-3 w-3" /> {p.status === "failed" ? "Not sent" : "Sending…"}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
