"use client";

/* eslint-disable @next/next/no-img-element */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Hash,
  Loader2,
  Minus,
  Plus,
  RotateCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addDays, atTime, dayKey, hhmm } from "@/components/planner/planner-utils";
import {
  fillFanslyNow,
  moveFanslyPost,
  planFanslyPost,
  recaptionFanslyDrafts,
  regenerateFanslyCaption,
  removeFanslyPost,
  resendFanslyPost,
  saveFanslyHashtags,
  saveFanslySlots,
  setFanslyApproved,
  setFanslyDaySlots,
  updateFanslyPost,
} from "@/app/(app)/vault/fansly-actions";
import type { VaultAsset } from "@/app/(app)/vault/page";

/**
 * The Fansly calendar in the vault. Two weeks of LA days, each with its
 * times; the app fills free times with Fansly cuts as drafts with a caption
 * from the cut's picture. Drafts are checked, moved by dragging, edited and
 * approved here; approved posts go to the VA the day before they are due.
 * A cut can also be planned by hand from its card.
 */

export type FanslyPlan = {
  id: string;
  asset_id: string;
  scheduled_for: string;
  caption: string;
  price: number | null;
  fyp: boolean;
  note: string | null;
  status: string;
  error: string | null;
  caption_source: string | null;
};

export type FanslyScheduleView = { slots: string[]; overrides: Record<string, string[]>; hashtags: string };

/** Fansly runs on LA time, so everything here is set and shown in it. */
const TZ = "America/Los_Angeles";
const DAYS = 14;
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${day}T12:00:00Z`)
  );

const STATUS: Record<string, { label: string; chip: string; edge: string }> = {
  draft: { label: "Draft", chip: "bg-amber-400/15 text-amber-200", edge: "border-amber-300/30" },
  approved: { label: "Approved", chip: "bg-emerald-400/15 text-emerald-200", edge: "border-emerald-300/40" },
  sending: { label: "Sending", chip: "bg-sky-400/15 text-sky-200", edge: "border-sky-300/40" },
  sent: { label: "With the VA", chip: "bg-sky-400/15 text-sky-200", edge: "border-sky-300/30" },
  failed: { label: "Not sent", chip: "bg-rose-400/15 text-rose-200", edge: "border-rose-300/40" },
};

type Ctx = { open: (asset: VaultAsset) => void; byAsset: Map<string, FanslyPlan[]>; hashtags: string };
const PlannerContext = createContext<Ctx | null>(null);

/** Null for anyone who may not plan (VAs, the model). */
export const useFanslyPlanner = () => useContext(PlannerContext);

export function FanslyPlannerProvider({
  enabled,
  plans,
  hashtags,
  children,
}: {
  enabled: boolean;
  plans: FanslyPlan[];
  hashtags: string;
  children: ReactNode;
}) {
  const [asset, setAsset] = useState<VaultAsset | null>(null);
  const byAsset = useMemo(() => {
    const m = new Map<string, FanslyPlan[]>();
    for (const p of plans) m.set(p.asset_id, [...(m.get(p.asset_id) ?? []), p]);
    return m;
  }, [plans]);
  const value = useMemo<Ctx>(() => ({ open: setAsset, byAsset, hashtags }), [byAsset, hashtags]);
  if (!enabled) return <>{children}</>;
  return (
    <PlannerContext.Provider value={value}>
      {children}
      <PostDialog asset={asset} plan={null} hashtags={hashtags} onClose={() => setAsset(null)} />
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

// ── The caption box ──

/** A tap away, for when the system picker will not land in the box. */
const QUICK_EMOJI = ["👅", "💦", "🔥", "👀", "😈", "🍑", "💋", "🥵", "😏", "🫦", "🤤", "❤️"];

function CaptionField({
  value,
  onChange,
  hashtags,
  onRegenerate,
}: {
  value: string;
  onChange: (v: string) => void;
  hashtags: string;
  onRegenerate?: () => Promise<void>;
}) {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [regenerating, setRegenerating] = useState(false);

  /** Put text where the cursor is, or at the end, and keep typing after it. */
  const insert = (text: string) => {
    const el = box.current;
    const at = el ? el.selectionStart : value.length;
    const to = el ? el.selectionEnd : value.length;
    onChange((value.slice(0, at) + text + value.slice(to)).slice(0, 3000));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
  };
  const addTags = () => {
    const have = new Set((value.match(/#[^\s#]+/g) ?? []).map((t) => t.toLowerCase()));
    const add = hashtags.split(/\s+/).filter((t) => t.startsWith("#") && !have.has(t.toLowerCase()));
    if (!add.length) return void toast.message("The hashtags are already in");
    onChange(`${value.trimEnd()}${value.trim() ? " " : ""}${add.join(" ")}`.slice(0, 3000));
  };
  const saveTags = async () => {
    const found = value.match(/#[^\s#]+/g) ?? [];
    if (!found.length) return void toast.error("No hashtags in the caption to save");
    const res = await saveFanslyHashtags(found.join(" "));
    if (res.error) return void toast.error(res.error);
    toast.success(`${new Set(found).size} hashtags are the default now`);
    router.refresh();
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">Caption</span>
        <span className="tabular-nums text-muted-foreground">{value.length}/3000</span>
      </div>
      <Textarea
        ref={box}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={3000}
        rows={5}
        placeholder="What goes under the post"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {QUICK_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => insert(e)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-base transition-colors hover:bg-white/10"
            title={`Add ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {onRegenerate && (
          <button
            type="button"
            disabled={regenerating}
            onClick={async () => {
              setRegenerating(true);
              await onRegenerate();
              setRegenerating(false);
            }}
            className="glass-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/85 hover:text-white disabled:opacity-50"
            title="Claude looks at the cut again and writes a new one"
          >
            {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} New caption
          </button>
        )}
        <button
          type="button"
          onClick={addTags}
          className="glass-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/85 hover:text-white"
          title={hashtags}
        >
          <Hash className="h-3.5 w-3.5" /> Add default hashtags
        </button>
        <button
          type="button"
          onClick={saveTags}
          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] text-white/50 hover:text-white"
          title="Make the hashtags in this caption the default for every caption"
        >
          <Save className="h-3 w-3" /> Save these as default
        </button>
      </div>
    </div>
  );
}

// ── One post: planned by hand, or opened from the calendar ──

function PostDialog({
  asset,
  plan,
  hashtags,
  onClose,
}: {
  asset: VaultAsset | null;
  plan: FanslyPlan | null;
  hashtags: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const tomorrow = () => dayKey(new Date(Date.now() + 86_400_000), TZ);
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("20:00");
  const [caption, setCaption] = useState("");
  const [ppv, setPpv] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const open = !!asset;

  // Opening a planned post fills the form from it; a new one starts fresh.
  useEffect(() => {
    if (!open) return;
    if (plan) {
      const at = new Date(plan.scheduled_for);
      setDate(dayKey(at, TZ));
      setTime(hhmm(at, TZ));
      setCaption(plan.caption);
      setPpv(!!plan.price);
      setPrice(plan.price ? String(plan.price) : "");
      setNote(plan.note ?? "");
    } else {
      setDate(tomorrow());
      setTime("20:00");
      setCaption("");
      setPpv(false);
      setPrice("");
      setNote("");
    }
  }, [open, plan]);

  const read = () => {
    const at = date && time ? atTime(date, time, TZ) : new Date(NaN);
    if (Number.isNaN(at.getTime())) return void toast.error("Pick a date and time");
    const amount = ppv ? Number(price.replace(",", ".")) : null;
    if (ppv && !(amount && amount > 0)) return void toast.error("Set the PPV price");
    return { when: at.toISOString(), caption, price: amount, note };
  };
  const run = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(ok);
        onClose();
      }
      router.refresh();
    });

  const sent = plan?.status === "sent" || plan?.status === "sending";
  const status = plan ? STATUS[plan.status] ?? STATUS.draft : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="max-h-[92dvh] max-w-lg overflow-y-auto"
        // The macOS emoji picker is a window of its own; picking from it must
        // not count as leaving the dialog, or the emoji never lands.
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {plan ? "Fansly post" : "Plan on Fansly"}
            {status && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.chip)}>{status.label}</span>}
          </DialogTitle>
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
                <p className="text-[11px] text-muted-foreground">
                  LA time, as in Fansly. FYP post. Goes to the VA the day before once approved.
                </p>
                {plan?.status === "failed" && plan.error && (
                  <p className="flex items-center gap-1 text-[11px] text-rose-300">
                    <AlertTriangle className="h-3 w-3" /> {plan.error}
                  </p>
                )}
              </div>
            </div>

            <CaptionField
              value={caption}
              onChange={setCaption}
              hashtags={hashtags}
              onRegenerate={
                plan
                  ? async () => {
                      const res = await regenerateFanslyCaption(plan.id);
                      if (res.error) toast.error(res.error);
                      else if (res.caption) setCaption(res.caption);
                    }
                  : undefined
              }
            />

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

            {!plan ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const v = read();
                  if (v) run(() => planFanslyPost({ assetId: asset.id, ...v }), "Planned — goes to the VA the day before");
                }}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Plan and approve
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeFanslyPost(plan.id), sent ? "Taken back, and out of the VA's topic" : "Removed")}
                  className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-60"
                  title={sent ? "Take it back and delete the task in the chat" : "Remove from the calendar"}
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
                <div className="ml-auto flex items-center gap-2">
                  {!sent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const v = read();
                        if (v) run(() => updateFanslyPost(plan.id, { ...v, approve: false }), "Saved as draft");
                      }}
                      className="glass-pill flex h-10 items-center rounded-full px-4 text-sm font-medium disabled:opacity-60"
                    >
                      Save draft
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const v = read();
                      if (!v) return;
                      if (sent)
                        run(async () => {
                          const r = await updateFanslyPost(plan.id, { ...v, approve: true });
                          return r.error ? r : resendFanslyPost(plan.id);
                        }, "Saved and sent to the VA again");
                      else run(() => updateFanslyPost(plan.id, { ...v, approve: true }), "Approved — goes to the VA the day before");
                    }}
                    className="flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    {sent ? "Save & send again" : "Save & approve"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The calendar ──

/** A post as a small card: picture, time, state, the caption's start. Dragged to move. */
function PostChip({
  plan,
  asset,
  onOpen,
  onApprove,
}: {
  plan: FanslyPlan;
  asset: VaultAsset | undefined;
  onOpen: () => void;
  onApprove: (on: boolean) => void;
}) {
  const locked = plan.status === "sent" || plan.status === "sending";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: plan.id, disabled: locked });
  const s = STATUS[plan.status] ?? STATUS.draft;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "group relative flex cursor-pointer gap-2 rounded-xl border bg-white/[0.06] p-1.5 text-left transition-shadow",
        s.edge,
        isDragging && "z-50 shadow-2xl ring-2 ring-white/40",
        !locked && "touch-none"
      )}
    >
      <div className="aspect-[9/16] w-9 shrink-0 overflow-hidden rounded-md bg-black/40">
        {asset?.thumbnailUrl && <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold tabular-nums">{hhmm(new Date(plan.scheduled_for), TZ)}</span>
          {(plan.status === "draft" || plan.status === "failed" || plan.status === "approved") && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onApprove(plan.status !== "approved");
              }}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                plan.status === "approved"
                  ? "border-emerald-400 bg-emerald-400 text-neutral-900"
                  : "border-white/30 text-white/60 hover:border-emerald-300 hover:text-emerald-200"
              )}
              title={plan.status === "approved" ? "Take approval back" : "Approve"}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </button>
          )}
        </div>
        <span className={cn("mt-0.5 inline-block rounded-full px-1.5 text-[9px] font-semibold", s.chip)}>
          {s.label}
          {plan.caption_source === "emoji" && plan.status === "draft" ? " · emojis" : ""}
        </span>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-white/70">{plan.caption.replace(/#[^\s#]+/g, "").trim() || "—"}</p>
      </div>
    </div>
  );
}

/** A time of a day: holds a post, or takes one dropped on it. */
function Slot({ day, time, children }: { day: string; time: string; children?: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day}|${time}` });
  return (
    <div ref={setNodeRef} className={cn("rounded-xl transition-colors", isOver && "bg-white/10 ring-2 ring-white/30")}>
      {children ?? (
        <div className="flex h-12 items-center justify-center rounded-xl border border-dashed border-white/15 text-[11px] text-white/40">
          {time} · free
        </div>
      )}
    </div>
  );
}

/** A day's own times, edited in place. */
function DayTimes({
  day,
  times,
  custom,
  onClose,
}: {
  day: string;
  times: string[];
  custom: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [list, setList] = useState(times);
  const [busy, start] = useTransition();
  const save = (value: string[] | null) =>
    start(async () => {
      const res = await setFanslyDaySlots(day, value);
      if (res.error) toast.error(res.error);
      else onClose();
      router.refresh();
    });
  return (
    <div className="space-y-1.5 rounded-xl border border-white/15 bg-black/30 p-2">
      {list.map((t, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            type="time"
            value={t}
            onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-8 text-xs"
          />
          <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="p-1 text-white/50 hover:text-white">
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setList((l) => [...l, "12:00"])}
        className="flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[11px] text-white/60 hover:bg-white/10"
      >
        <Plus className="h-3 w-3" /> Time
      </button>
      <div className="flex items-center gap-1">
        {custom && (
          <button type="button" disabled={busy} onClick={() => save(null)} className="rounded-full px-2 py-1 text-[10px] text-white/50 hover:text-white">
            Usual times
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => save(list)}
          className="ml-auto rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-900 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function FanslyCalendar({
  plans,
  assets,
  schedule,
  today,
}: {
  plans: FanslyPlan[];
  assets: VaultAsset[];
  schedule: FanslyScheduleView;
  /** Today in LA, from the server, so the page draws the same days on both sides. */
  today: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(plans);
  useEffect(() => setList(plans), [plans]);
  const [editing, setEditing] = useState<FanslyPlan | null>(null);
  const [dayEdit, setDayEdit] = useState<string | null>(null);
  const [timesOpen, setTimesOpen] = useState(false);
  const [usual, setUsual] = useState(schedule.slots);
  useEffect(() => setUsual(schedule.slots), [schedule.slots]);
  const [busy, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  const byDay = useMemo(() => {
    const m = new Map<string, FanslyPlan[]>();
    for (const p of list) {
      const d = dayKey(new Date(p.scheduled_for), TZ);
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    Array.from(m.values()).forEach((v) => v.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)));
    return m;
  }, [list]);
  const shown = list.filter((p) => days.includes(dayKey(new Date(p.scheduled_for), TZ)));
  const drafts = shown.filter((p) => p.status === "draft" || p.status === "failed");
  const count = (s: string) => shown.filter((p) => p.status === s).length;

  const act = (fn: () => Promise<{ error: string | null }>, ok?: string, undo?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) {
        undo?.();
        toast.error(res.error);
      } else if (ok) toast.success(ok);
      router.refresh();
    });

  const approve = (ids: string[], on: boolean) => {
    const before = list;
    setList((l) => l.map((p) => (ids.includes(p.id) ? { ...p, status: on ? "approved" : "draft" } : p)));
    act(() => setFanslyApproved(ids, on), ids.length > 1 ? `${ids.length} posts approved` : undefined, () => setList(before));
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const [day, time] = String(e.over.id).split("|");
    const id = String(e.active.id);
    const moving = list.find((p) => p.id === id);
    if (!moving || (dayKey(new Date(moving.scheduled_for), TZ) === day && hhmm(new Date(moving.scheduled_for), TZ) === time)) return;
    const target = atTime(day, time, TZ).toISOString();
    // Compared as moments: the database writes "+00:00" where JS writes "Z".
    const other = list.find((p) => p.id !== id && new Date(p.scheduled_for).getTime() === new Date(target).getTime());
    const before = list;
    setList((l) =>
      l.map((p) =>
        p.id === id ? { ...p, scheduled_for: target } : other && p.id === other.id ? { ...p, scheduled_for: moving.scheduled_for } : p
      )
    );
    act(() => moveFanslyPost(id, day, time), undefined, () => setList(before));
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Fansly calendar</h2>
          <p className="text-xs text-white/55">
            LA time · {count("draft")} drafts · {count("approved")} approved · {count("sent")} with the VA — approved posts go to her the day before
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTimesOpen((o) => !o)}
            className="glass-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
          >
            <Clock className="h-3.5 w-3.5" /> {schedule.slots.length} a day
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const res = await fillFanslyNow();
                if (res.error) toast.error(res.error);
                else if (!res.created) toast.message(res.short ? `No Fansly cuts left for ${res.short} free times` : "Every time is filled");
                else toast.success(`${res.created} drafts added${res.short ? ` · ${res.short} times still free — no cuts left` : ""}`);
                router.refresh();
              })
            }
            className="glass-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            title="Fill the free times of the next two weeks with Fansly cuts and captions"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Fill now
          </button>
          {drafts.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const res = await recaptionFanslyDrafts();
                  if (res.error) toast.error(res.error);
                  else toast.success(`${res.count ?? 0} drafts have new captions`);
                  router.refresh();
                })
              }
              className="glass-pill flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              title="Claude writes every draft's caption again; captions you wrote yourself stay"
            >
              <Sparkles className="h-3.5 w-3.5" /> New captions
            </button>
          )}
          {drafts.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => approve(drafts.map((d) => d.id), true)}
              className="flex items-center gap-1.5 rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-900 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} /> Approve all {drafts.length}
            </button>
          )}
        </div>
      </div>

      {timesOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <span className="text-xs text-white/60">Posts a day, LA time:</span>
          {usual.map((t, i) => (
            <Input
              key={i}
              type="time"
              value={t}
              onChange={(e) => setUsual((u) => u.map((x, j) => (j === i ? e.target.value : x)))}
              className="h-8 w-28 text-xs"
            />
          ))}
          <button
            type="button"
            onClick={() => setUsual((u) => (u.length > 1 ? u.slice(0, -1) : u))}
            className="glass-pill flex h-8 w-8 items-center justify-center rounded-full"
            aria-label="One fewer"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setUsual((u) => [...u, u.length ? addHour(u[u.length - 1]) : "12:00"])}
            className="glass-pill flex h-8 w-8 items-center justify-center rounded-full"
            aria-label="One more"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => saveFanslySlots(usual), "Times saved — Fill now puts cuts in the new ones")}
            className="ml-auto rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => {
            const custom = !!schedule.overrides[d];
            const times = schedule.overrides[d] ?? schedule.slots;
            const posts = byDay.get(d) ?? [];
            const at = new Map(posts.map((p) => [hhmm(new Date(p.scheduled_for), TZ), p]));
            const extra = posts.filter((p) => !times.includes(hhmm(new Date(p.scheduled_for), TZ)));
            return (
              <div key={d} className={cn("min-w-0 rounded-2xl border border-white/10 bg-black/15 p-2", d === today && "border-white/30")}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold">
                    {d === today ? "Today" : dayLabel(d)}
                    {custom && <span className="ml-1 text-[9px] font-medium text-amber-200">own times</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDayEdit((x) => (x === d ? null : d))}
                    className="rounded-full p-1 text-white/45 hover:text-white"
                    title="This day's times"
                  >
                    {dayEdit === d ? <X className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {dayEdit === d ? (
                  <DayTimes day={d} times={times} custom={custom} onClose={() => setDayEdit(null)} />
                ) : (
                  <div className="space-y-1.5">
                    {times.map((t) => {
                      const p = at.get(t);
                      return (
                        <Slot key={t} day={d} time={t}>
                          {p ? (
                            <PostChip plan={p} asset={byId.get(p.asset_id)} onOpen={() => setEditing(p)} onApprove={(on) => approve([p.id], on)} />
                          ) : undefined}
                        </Slot>
                      );
                    })}
                    {extra.map((p) => (
                      <PostChip key={p.id} plan={p} asset={byId.get(p.asset_id)} onOpen={() => setEditing(p)} onApprove={(on) => approve([p.id], on)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DndContext>

      <PostDialog
        asset={editing ? byId.get(editing.asset_id) ?? null : null}
        plan={editing}
        hashtags={schedule.hashtags}
        onClose={() => setEditing(null)}
      />
      {editing && !byId.get(editing.asset_id) && (
        <p className="mt-2 text-xs text-rose-300">That cut is no longer in the vault.</p>
      )}
      <ResendHint plans={shown} />
    </div>
  );
}

/** Failed sends, with a button to try again. */
function ResendHint({ plans }: { plans: FanslyPlan[] }) {
  const router = useRouter();
  const failed = plans.filter((p) => p.status === "failed");
  const [busy, start] = useTransition();
  if (!failed.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
      <AlertTriangle className="h-3.5 w-3.5" /> {failed.length} not sent to the VA: {failed[0].error ?? "unknown error"}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            for (const p of failed) {
              const r = await resendFanslyPost(p.id);
              if (r.error) toast.error(r.error);
            }
            router.refresh();
          })
        }
        className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-medium hover:bg-white/20"
      >
        <RotateCw className="h-3 w-3" /> Try again
      </button>
    </div>
  );
}

const addHour = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
