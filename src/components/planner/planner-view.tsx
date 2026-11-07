"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FlaskConical,
  Globe,
  Image as ImageIcon,
  Images,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountAvatar, PlatformLogo } from "@/components/pipeline/account-avatar";
import {
  connectInstagram,
  disconnectInstagram,
  setPlannerSettings,
  updatePost,
} from "@/app/(app)/planner/[accountId]/actions";
import { PostEditor, type EditorTarget } from "@/components/planner/post-editor";
import { FeedComposer } from "@/components/planner/feed-composer";
import { FillDialog, planFill, type FillItem } from "@/components/planner/fill-dialog";
import {
  addDays,
  addMonths,
  atTime,
  dayKey,
  hhmm,
  postingTimes,
  startOfMonth,
  startOfWeek,
  stateOf,
  STATE_META,
  TIMEZONES,
  tzLabel,
  whenLabel,
  type HourWindow,
} from "@/components/planner/planner-utils";

export type PlannerCut = {
  id: string;
  requestId: string;
  title: string;
  /** "2/6": the second of six cuts of the reel. */
  variant: string | null;
  thumb: string | null;
  video: string;
  uploadedAt: string;
  /** Accounts this cut already went out on. */
  usedOn: string[];
  /** Planned for auto-posting somewhere. */
  queued: boolean;
  /** The reel's best plays against its account's usual reach, anywhere. */
  lift: number | null;
};

export type PlannerPost = {
  id: string;
  assetId: string | null;
  requestId: string | null;
  kind: "reel" | "image" | "carousel";
  /** A feed post's pictures, in order. */
  images: string[];
  title: string;
  variant: string | null;
  thumb: string | null;
  video: string | null;
  /** When it goes out, or went out. */
  at: string;
  caption: string;
  trialReel: boolean;
  shareToFeed: boolean;
  status: string;
  publishState: string | null;
  publishError: string | null;
  postUrl: string | null;
  /** Planned here; false is a post a VA marked by hand. */
  auto: boolean;
};

type Drag = { kind: "cut"; id: string } | { kind: "post"; id: string } | null;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The planner, Later-style: the vault's cuts on the left, the calendar on
 * the right. Drag a cut onto a day (or onto one of its free times) to plan
 * it; drag a planned post to another day to move it; click anything to
 * open it. Week view shows each day's posting times as free slots, so the
 * gaps are visible at a glance.
 *
 * Everything runs on the account's clock (a US account plans in New York
 * time), and its free times are the researched ones (see postingTimes).
 */
export function PlannerView({
  account,
  connection,
  migrated,
  feedReady,
  cuts,
  posts: initialPosts,
  windows,
  ownReels,
}: {
  account: {
    id: string;
    label: string;
    platform: string;
    avatar: string | null;
    perDay: number;
    hasTopic: boolean;
    personaId: string;
    tz: string;
  };
  connection: { username: string | null; expiresAt: string | null } | null;
  migrated: boolean;
  feedReady: boolean;
  cuts: PlannerCut[];
  posts: PlannerPost[];
  windows: HourWindow[];
  ownReels: number;
}) {
  const tz = account.tz;
  const router = useRouter();
  // Dates render in the viewer's own time zone, which the server does not
  // know: the calendar draws once mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [posts, setPosts] = useState(initialPosts);
  useEffect(() => setPosts(initialPosts), [initialPosts]);
  // While something is on its way to Instagram, look again now and then.
  const live = posts.some((p) => stateOf(p) === "publishing");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [live, router]);

  const [view, setView] = useState<"week" | "month">("week");
  const today = dayKey(new Date(), tz);
  const [anchor, setAnchor] = useState(() => startOfWeek(dayKey(new Date(), tz)));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  // A free time clicked in the calendar: the next cut clicked fills it.
  const [picking, setPicking] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"free" | "all">("free");
  const [search, setSearch] = useState("");
  /** The reel whose takes are open in the vault; null shows one tile per reel. */
  const [openReel, setOpenReel] = useState<string | null>(null);
  const [composer, setComposer] = useState<Date | null>(null);
  const [fill, setFill] = useState<FillItem[] | null>(null);

  // The researched posting times; Friday and Saturday shift theirs.
  const times = postingTimes(account.perDay);
  const timesOn = (day: string) => postingTimes(account.perDay, day);
  const canPlan = migrated;
  const canPublish = migrated && !!connection;

  const byDay = useMemo(() => {
    const m = new Map<string, PlannerPost[]>();
    for (const p of posts) {
      const k = dayKey(new Date(p.at), tz);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    m.forEach((list) => list.sort((a, b) => a.at.localeCompare(b.at)));
    return m;
  }, [posts, tz]);

  const plannedCuts = useMemo(
    () => new Set(posts.filter((p) => p.auto && p.status !== "posted" && p.publishState !== "failed").map((p) => p.assetId)),
    [posts]
  );
  const shownCuts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cuts.filter((c) => {
      if (filter === "free" && (c.usedOn.length > 0 || c.queued || plannedCuts.has(c.id))) return false;
      return !q || c.title.toLowerCase().includes(q);
    });
  }, [cuts, filter, search, plannedCuts]);

  // One tile per reel: its newest shown take on top, with how many it has.
  const reels = useMemo(() => {
    const isFree = (c: PlannerCut) => c.usedOn.length === 0 && !c.queued && !plannedCuts.has(c.id);
    const total = new Map<string, { all: number; free: number }>();
    for (const c of cuts) {
      const t = total.get(c.requestId) ?? { all: 0, free: 0 };
      t.all++;
      if (isFree(c)) t.free++;
      total.set(c.requestId, t);
    }
    const byReel = new Map<string, PlannerCut[]>();
    for (const c of shownCuts) byReel.set(c.requestId, [...(byReel.get(c.requestId) ?? []), c]);
    return Array.from(byReel, ([requestId, list]) => ({
      requestId,
      title: list[0].title,
      cover: list[0],
      takes: list,
      ...total.get(requestId)!,
    }));
  }, [cuts, shownCuts, plannedCuts]);
  const openTakes = openReel ? shownCuts.filter((c) => c.requestId === openReel) : [];
  const openTitle = openReel ? cuts.find((c) => c.requestId === openReel)?.title ?? "" : "";

  const lastCaption = useMemo(
    () =>
      [...posts]
        .filter((p) => p.auto && p.caption)
        .sort((a, b) => b.at.localeCompare(a.at))[0]?.caption ?? null,
    [posts]
  );

  // ── The numbers on top ──
  const stats = useMemo(() => {
    const now = Date.now();
    const ahead = posts
      .filter((p) => p.auto && p.status === "scheduled" && p.publishState !== "failed" && new Date(p.at).getTime() > now - 10 * 60_000)
      .sort((a, b) => a.at.localeCompare(b.at));
    const last = ahead[ahead.length - 1];
    const days = last ? Math.max(0, Math.ceil((new Date(last.at).getTime() - now) / 86_400_000)) : 0;
    return {
      scheduled: ahead.length,
      next: ahead[0] ?? null,
      until: last ? new Date(last.at) : null,
      days,
      posted7: posts.filter((p) => p.status === "posted" && now - new Date(p.at).getTime() < 7 * 86_400_000).length,
      failed: posts.filter((p) => stateOf(p) === "failed").length,
      waiting: posts.filter((p) => stateOf(p) === "overdue").length,
    };
  }, [posts]);

  // The first free posting time from now on, for a cut clicked without a day.
  const nextFree = (): Date => {
    for (let i = 0; i < 60; i++) {
      const t = freeTimes(addDays(today, i))[0];
      if (t) return t;
    }
    return new Date(Date.now() + 3600_000);
  };
  const freeTimes = (day: string): Date[] => {
    const taken = (byDay.get(day) ?? []).map((p) => new Date(p.at).getTime());
    return timesOn(day)
      .map((t) => atTime(day, t, tz))
      .filter((d) => d.getTime() > Date.now() + 5 * 60_000)
      .filter((d) => !taken.some((x) => Math.abs(x - d.getTime()) < 45 * 60_000));
  };
  const suggestFor = (day: string): Date => {
    const free = freeTimes(day)[0];
    if (free) return free;
    if (day !== today) return atTime(day, timesOn(day).at(-1)!, tz);
    const base = new Date(Date.now() + 30 * 60_000);
    base.setMinutes(Math.ceil(base.getMinutes() / 15) * 15, 0, 0);
    return base;
  };

  const openCut = (cut: PlannerCut, at?: Date) => {
    if (!canPlan) return void toast.error("The database update for auto-posting is not applied yet");
    setEditor({ mode: "new", cut, at: at ?? picking ?? nextFree() });
    setPicking(null);
  };

  // ── Dropping ──
  const dropOn = (day: string, exact?: Date) => {
    const d = drag;
    setDrag(null);
    setOver(null);
    if (!d) return;
    if (d.kind === "cut") {
      const cut = cuts.find((c) => c.id === d.id);
      if (cut) openCut(cut, exact ?? suggestFor(day));
      return;
    }
    const post = posts.find((p) => p.id === d.id);
    if (!post) return;
    const st = stateOf(post);
    if (!["scheduled", "overdue", "failed"].includes(st)) return void toast.error("That one is already out");
    const old = new Date(post.at);
    const at = exact ?? atTime(day, hhmm(old, tz), tz);
    if (at.getTime() < Date.now()) return void toast.error("That time has passed");
    if (at.getTime() === old.getTime()) return;
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, at: at.toISOString() } : p)));
    void updatePost(post.id, { scheduledFor: at.toISOString() }).then((res) => {
      if (res.error) {
        toast.error(res.error);
        setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, at: post.at } : p)));
      } else {
        toast.success(`Moved to ${whenLabel(at, tz)}`);
        router.refresh();
      }
    });
  };
  const dropProps = (key: string, day: string, exact?: Date) =>
    canPlan
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!drag) return;
            e.preventDefault();
            e.stopPropagation();
            if (over !== key) setOver(key);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dropOn(day, exact);
          },
        }
      : {};

  // ── Range ──
  const days = useMemo(() => {
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
    const start = startOfWeek(anchor);
    const last = addDays(addMonths(anchor, 1), -1);
    const n = Math.max(35, Math.ceil((Date.parse(last) - Date.parse(start)) / 86_400_000 / 7 + 0.0001) * 7);
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  }, [view, anchor]);
  const step = (dir: number) => setAnchor((a) => (view === "week" ? addDays(a, dir * 7) : addMonths(a, dir)));
  const goToday = () => setAnchor(view === "week" ? startOfWeek(today) : startOfMonth(today));
  const switchView = (v: "week" | "month") => {
    setView(v);
    setAnchor(v === "week" ? startOfWeek(anchor) : startOfMonth(anchor));
  };
  // Day keys are calendar dates; noon UTC names them in any zone.
  const dateOf = (key: string) => new Date(`${key}T12:00:00Z`);
  const rangeLabel = mounted
    ? view === "week"
      ? `${dateOf(anchor).toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "short" })} – ${dateOf(addDays(anchor, 6)).toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" })}`
      : dateOf(anchor).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" })
    : "";

  // ── Fill free times ──
  const startFill = () => {
    const slots = days.flatMap((d) => freeTimes(d));
    const plan = planFill({ slots, cuts, posts, plannedCuts });
    if (!plan.length) {
      return void toast.error(
        slots.length ? "No unused takes left that keep two days between takes of one reel" : "No free times left in this range"
      );
    }
    setFill(plan);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/?tab=accounts" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Accounts
        </Link>
        <div className="flex items-center gap-2.5">
          <AccountAvatar src={account.avatar} platform={account.platform} label={account.label} size={36} />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{account.label}</h1>
            <p className="text-[11px] text-muted-foreground">Auto-post planner</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Settings accountId={account.id} tz={tz} perDay={account.perDay} />
          <ConnectionPill accountId={account.id} connection={connection} migrated={migrated} />
        </div>
      </div>

      {!migrated && (
        <Banner tone="amber">
          The database update for auto-posting (00062) is not applied yet — the planner is read-only until it is.
        </Banner>
      )}
      {migrated && !connection && stats.scheduled > 0 && (
        <Banner tone="amber">
          {stats.scheduled} post{stats.scheduled === 1 ? " is" : "s are"} planned, but Instagram is not connected — they wait until it is.
        </Banner>
      )}

      {/* The numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Scheduled" value={String(stats.scheduled)} hint="posts ahead" />
        <Stat
          label="Covered until"
          value={mounted && stats.until ? whenLabel(stats.until, tz, false) : "—"}
          hint={stats.until ? `${stats.days} day${stats.days === 1 ? "" : "s"}` : "nothing planned"}
          tone={stats.days <= 2 ? "rose" : stats.days <= 5 ? "amber" : "emerald"}
        />
        <Stat
          label="Next post"
          value={mounted && stats.next ? whenLabel(new Date(stats.next.at), tz) : "—"}
          hint={stats.next ? stats.next.title : "drag a cut onto a day"}
        />
        <Stat label="Posted · 7 days" value={String(stats.posted7)} hint="auto and by hand" />
        <Stat
          label="Needs a look"
          value={String(stats.failed + stats.waiting)}
          hint={stats.failed ? `${stats.failed} failed` : stats.waiting ? `${stats.waiting} waiting` : "all good"}
          tone={stats.failed + stats.waiting > 0 ? "rose" : undefined}
        />
      </div>

      <BestTimes windows={windows} ownReels={ownReels} times={times} tz={tz} label={account.label} />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* The vault */}
        <aside
          className={`flex max-h-[calc(100vh-220px)] min-h-[420px] flex-col rounded-2xl border bg-card/60 p-3 transition-colors lg:sticky lg:top-0 ${
            picking ? "border-primary ring-2 ring-primary/40" : "border-border/50"
          }`}
        >
          <button
            type="button"
            disabled={!canPlan || !feedReady}
            title={feedReady ? "One picture or a carousel of up to ten" : "Needs the database update 00063"}
            onClick={() => {
              setComposer(picking ?? nextFree());
              setPicking(null);
            }}
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/50 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            <Images className="h-3.5 w-3.5" /> New feed post
          </button>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Vault</h2>
            <div className="flex rounded-md border border-border/50 p-0.5 text-[11px]">
              {(["free", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded px-2 py-0.5 ${filter === f ? "bg-muted font-semibold" : "text-muted-foreground"}`}
                >
                  {f === "free" ? "Unused" : "All"}
                </button>
              ))}
            </div>
          </div>
          {picking ? (
            <p className="mb-2 rounded-md bg-primary/15 px-2 py-1.5 text-[11px] text-primary">
              Pick a cut for {whenLabel(picking, tz)}{" "}
              ·{" "}
              <button type="button" className="underline" onClick={() => setPicking(null)}>
                cancel
              </button>
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-muted-foreground">Click a reel to see its takes. Drag a take onto a day, or click it to plan it at the next free time.</p>
          )}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpenReel(null);
              }}
              placeholder="Reel #…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          {openReel && (
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpenReel(null)}
                className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] hover:bg-muted/40"
              >
                <ChevronLeft className="h-3 w-3" /> All reels
              </button>
              <span className="truncate text-xs font-semibold">{openTitle}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {openTakes.length} take{openTakes.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
          <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid auto-rows-max grid-cols-2 gap-2">
            {(openReel ? openTakes.length : reels.length) === 0 && (
              <p className="col-span-2 py-8 text-center text-xs text-muted-foreground">
                {filter === "free"
                  ? openReel
                    ? "Every take of this reel is used or planned — switch to All"
                    : "Every cut is used or planned — switch to All"
                  : "No cuts found"}
              </p>
            )}
            {openReel
              ? openTakes.map((c) => (
                  <CutTile
                    key={c.id}
                    cut={c}
                    planned={plannedCuts.has(c.id) || c.queued}
                    draggable={canPlan}
                    onDragStart={() => setDrag({ kind: "cut", id: c.id })}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onClick={() => openCut(c)}
                  />
                ))
              : reels.map((r) => (
                  <ReelTile
                    key={r.requestId}
                    cover={r.cover}
                    title={r.title}
                    all={r.all}
                    free={r.free}
                    draggable={canPlan}
                    onDragStart={() => setDrag({ kind: "cut", id: r.cover.id })}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onClick={() => setOpenReel(r.requestId)}
                  />
                ))}
          </div>
          </div>
        </aside>

        {/* The calendar */}
        <section className="min-w-0 rounded-2xl border border-border/50 bg-card/60 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => step(-1)} aria-label="Back">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={goToday}>
                Today
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => step(1)} aria-label="Forward">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <h2 className="text-sm font-semibold">{rangeLabel}</h2>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 gap-1.5"
              disabled={!canPlan || !mounted}
              onClick={startFill}
              title="Plans the best unused takes into this range's free times"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Fill free times
            </Button>
            <div className="flex rounded-md border border-border/50 p-0.5 text-xs">
              {(["week", "month"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => switchView(v)}
                  className={`rounded px-3 py-1 ${view === v ? "bg-muted font-semibold" : "text-muted-foreground"}`}
                >
                  {v === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>

          {!mounted ? (
            <div className="flex h-[480px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : view === "week" ? (
            <div className="grid grid-cols-7 gap-2 overflow-x-auto">
              {days.map((day, i) => {
                const key = day;
                const list = byDay.get(key) ?? [];
                const free = freeTimes(day);
                const isToday = key === today;
                const past = key < today;
                // Posts and free times in one line-up by the clock.
                const items: ({ kind: "post"; at: number; post: PlannerPost } | { kind: "free"; at: number; time: Date })[] = [
                  ...list.map((p) => ({ kind: "post" as const, at: new Date(p.at).getTime(), post: p })),
                  ...free.map((t) => ({ kind: "free" as const, at: t.getTime(), time: t })),
                ].sort((a, b) => a.at - b.at);
                return (
                  <div
                    key={key}
                    {...(past ? {} : dropProps(key, day))}
                    className={`flex min-h-[520px] min-w-[120px] flex-col rounded-xl border p-1.5 transition-colors ${
                      over === key ? "border-primary bg-primary/10" : isToday ? "border-primary/40 bg-primary/[0.03]" : "border-border/40"
                    } ${past ? "opacity-60" : ""}`}
                  >
                    <div className="mb-1.5 flex items-baseline justify-between px-1">
                      <span className={`text-xs font-semibold ${isToday ? "text-primary" : ""}`}>
                        {WEEKDAYS[i]} {Number(key.slice(8))}.
                      </span>
                      {list.length > 0 && <span className="text-[10px] text-muted-foreground">{list.length}</span>}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      {items.map((it) =>
                        it.kind === "post" ? (
                          <PostCard
                            key={it.post.id}
                            post={it.post}
                            tz={tz}
                            draggable={canPlan && ["scheduled", "overdue", "failed"].includes(stateOf(it.post))}
                            onDragStart={() => setDrag({ kind: "post", id: it.post.id })}
                            onDragEnd={() => {
                              setDrag(null);
                              setOver(null);
                            }}
                            onClick={() => setEditor({ mode: "edit", post: it.post })}
                          />
                        ) : (
                          <FreeSlot
                            key={`free-${it.at}`}
                            time={it.time}
                            tz={tz}
                            active={over === `${key}|${it.at}` || picking?.getTime() === it.at}
                            dropProps={dropProps(`${key}|${it.at}`, day, it.time)}
                            onClick={() => (canPlan ? setPicking(it.time) : undefined)}
                          />
                        )
                      )}
                      {!past && (
                        <div className="flex flex-1 items-end">
                          <p
                            className={`w-full rounded-md border border-dashed py-2 text-center text-[10px] transition-colors ${
                              over === key ? "border-primary text-primary" : "border-transparent text-transparent"
                            }`}
                          >
                            Drop to plan
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="mb-1 grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((d) => (
                  <p key={d} className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {d}
                  </p>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((day) => {
                  const key = day;
                  const list = byDay.get(key) ?? [];
                  const inMonth = key.slice(0, 7) === anchor.slice(0, 7);
                  const isToday = key === today;
                  const past = key < today;
                  const openSlots = past ? 0 : freeTimes(day).length;
                  return (
                    <div
                      key={key}
                      {...(past ? {} : dropProps(key, day))}
                      className={`min-h-[118px] rounded-lg border p-1.5 transition-colors ${
                        over === key ? "border-primary bg-primary/10" : isToday ? "border-primary/40" : "border-border/40"
                      } ${inMonth ? "" : "opacity-40"}`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setView("week");
                            setAnchor(startOfWeek(day));
                          }}
                          className={`text-xs font-semibold hover:underline ${isToday ? "text-primary" : ""}`}
                        >
                          {Number(key.slice(8))}
                        </button>
                        {openSlots > 0 && list.length === 0 && (
                          <span className="text-[9px] text-muted-foreground/60">{openSlots} free</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {list.slice(0, 6).map((p) => {
                          const st = stateOf(p);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              draggable={canPlan && ["scheduled", "overdue", "failed"].includes(st)}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                setDrag({ kind: "post", id: p.id });
                              }}
                              onDragEnd={() => {
                                setDrag(null);
                                setOver(null);
                              }}
                              onClick={() => setEditor({ mode: "edit", post: p })}
                              title={`${hhmm(new Date(p.at), tz)} · ${p.title} · ${STATE_META[st].label}`}
                              className={`relative h-12 w-7 overflow-hidden rounded ring-2 ${STATE_META[st].ring}`}
                            >
                              <Thumb src={p.thumb} />
                            </button>
                          );
                        })}
                        {list.length > 6 && (
                          <span className="self-end text-[10px] text-muted-foreground">+{list.length - 6}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {(["scheduled", "publishing", "posted", "manual", "failed"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ring-2 ${STATE_META[s].ring}`} />
                {STATE_META[s].label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded border border-dashed border-muted-foreground/50" /> Free posting time ({times.join(", ")}{" "}
              {tzLabel(tz)}
              {mounted && tz !== "Europe/Berlin" && ` = ${times.map((t) => hhmm(atTime(today, t, tz), "Europe/Berlin")).join(", ")} Berlin`}
              ; Fri/Sat evening 21:30)
            </span>
          </div>
        </section>
      </div>

      <PostEditor
        accountId={account.id}
        target={editor}
        lastCaption={lastCaption}
        canPublish={canPublish}
        tz={tz}
        posts={posts}
        onClose={() => setEditor(null)}
        onChanged={() => router.refresh()}
      />
      <FeedComposer
        accountId={account.id}
        personaId={account.personaId}
        at={composer}
        tz={tz}
        lastCaption={lastCaption}
        canPublish={canPublish}
        onClose={() => setComposer(null)}
        onChanged={() => router.refresh()}
      />
      <FillDialog
        accountId={account.id}
        items={fill}
        tz={tz}
        lastCaption={lastCaption}
        onClose={() => setFill(null)}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

/** A reel in the vault: its cover take, and how many takes it has. Dragging it plans that take. */
function ReelTile({
  cover,
  title,
  all,
  free,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  cover: PlannerCut;
  title: string;
  all: number;
  free: number;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", cover.id);
        setHover(false);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative block aspect-[9/16] w-full shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border/40 bg-black text-left"
    >
      {hover ? (
        <video src={cover.video} poster={cover.thumb ?? undefined} autoPlay muted loop playsInline className="h-full w-full object-cover" />
      ) : (
        <Thumb src={cover.thumb} video={cover.video} />
      )}
      <span className="absolute right-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {all} take{all === 1 ? "" : "s"}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5 pt-6">
        <p className="truncate text-[11px] font-semibold text-white">{title}</p>
        <p className={`truncate text-[9px] ${free > 0 ? "text-emerald-300" : "text-white/60"}`}>
          {free > 0 ? `${free} unused` : "all used or planned"}
        </p>
      </div>
    </button>
  );
}

function CutTile({
  cut,
  planned,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  cut: PlannerCut;
  planned: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", cut.id);
        setHover(false);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative block aspect-[9/16] w-full shrink-0 cursor-grab overflow-hidden rounded-lg border border-border/40 bg-black text-left active:cursor-grabbing"
    >
      {hover ? (
        <video src={cut.video} poster={cut.thumb ?? undefined} autoPlay muted loop playsInline className="h-full w-full object-cover" />
      ) : (
        <Thumb src={cut.thumb} video={cut.video} />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5 pt-6">
        <p className="truncate text-[11px] font-semibold text-white">{cut.title}</p>
        <p className="truncate text-[9px] text-white/70">
          {cut.variant ? `cut ${cut.variant}` : "single cut"}
          {cut.usedOn.length > 0 && ` · on ${cut.usedOn.join(", ")}`}
        </p>
      </div>
      {(planned || cut.usedOn.length > 0) && (
        <span
          className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold ${
            planned ? "bg-sky-500/90 text-white" : "bg-black/70 text-white/80"
          }`}
        >
          {planned ? "Planned" : "Used"}
        </span>
      )}
    </button>
  );
}

function PostCard({
  post,
  tz,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  post: PlannerPost;
  tz: string;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const st = stateOf(post);
  const meta = STATE_META[st];
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", post.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-lg bg-black text-left ring-2 transition-transform hover:scale-[1.02] ${meta.ring} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="aspect-[4/5] w-full">
        <Thumb src={post.thumb} video={post.video} />
      </div>
      <div className="absolute left-1 top-1 flex items-center gap-1">
        <span className="flex items-center gap-0.5 rounded bg-black/75 px-1 py-0.5 text-[10px] font-semibold text-white">
          <Clock className="h-2.5 w-2.5" />
          {hhmm(new Date(post.at), tz)}
        </span>
        {post.kind !== "reel" && (
          <span className="rounded bg-black/75 p-0.5 text-white" title={post.kind === "carousel" ? "Carousel" : "Feed post"}>
            {post.kind === "carousel" ? <Images className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
          </span>
        )}
        {post.trialReel && (
          <span className="rounded bg-fuchsia-500/90 p-0.5 text-white" title="Trial reel">
            <FlaskConical className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5 pt-5">
        <p className="truncate text-[10px] font-semibold text-white">{post.title}</p>
        <span className={`mt-0.5 inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-semibold ${meta.chip}`}>
          {st === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {st === "posted" && <CheckCircle2 className="h-2.5 w-2.5" />}
          {st === "failed" && <AlertTriangle className="h-2.5 w-2.5" />}
          {meta.label}
        </span>
      </div>
    </button>
  );
}

function FreeSlot({
  time,
  tz,
  active,
  dropProps,
  onClick,
}: {
  time: Date;
  tz: string;
  active: boolean;
  dropProps: Record<string, unknown>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      {...dropProps}
      onClick={onClick}
      className={`flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] transition-colors ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border/60 text-muted-foreground/70 hover:border-primary/60 hover:text-primary"
      }`}
    >
      <Plus className="h-3 w-3" />
      {hhmm(time, tz)}
    </button>
  );
}

function Thumb({ src, video }: { src: string | null; video?: string | null }) {
  if (src) return <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />;
  // No stored picture: the video's own first frame.
  if (video) return <video src={`${video}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  return <div className="h-full w-full bg-muted/30" />;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "rose" | "amber" | "emerald";
}) {
  const color = tone === "rose" ? "text-rose-400" : tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-400" : "";
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The account's clock and pace, right in the header. */
function Settings({ accountId, tz, perDay }: { accountId: string; tz: string; perDay: number }) {
  const router = useRouter();
  const save = async (patch: { timezone?: string; perDay?: number }) => {
    const res = await setPlannerSettings(accountId, patch);
    if (res.error) toast.error(res.error);
    else router.refresh();
  };
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <label className="flex items-center gap-1 rounded-full border border-border/50 py-1 pl-2.5 pr-1 text-muted-foreground">
        <Globe className="h-3.5 w-3.5" />
        <select
          value={tz}
          onChange={(e) => save({ timezone: e.target.value })}
          className="bg-transparent text-xs text-foreground outline-none"
          title="The time zone this account posts for — the calendar shows its times"
        >
          {!TIMEZONES.some((t) => t.id === tz) && <option value={tz}>{tz}</option>}
          {TIMEZONES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 rounded-full border border-border/50 py-1 pl-2.5 pr-1 text-muted-foreground">
        Posts a day
        <select
          value={perDay}
          onChange={(e) => save({ perDay: Number(e.target.value) })}
          className="bg-transparent text-xs text-foreground outline-none"
        >
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * When the account's reels do best, by the two hours they went up in:
 * the median against its usual reach — beside the researched free times,
 * to see whether the account agrees with them.
 */
function BestTimes({
  windows,
  ownReels,
  times,
  tz,
  label,
}: {
  windows: HourWindow[];
  ownReels: number;
  times: string[];
  tz: string;
  label: string;
}) {
  const top = Math.max(1, ...windows.map((w) => w.lift ?? 0));
  const picked = new Set(times.map((t) => Math.floor(Number(t.slice(0, 2)) / 2)));
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Best times · {tzLabel(tz)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Free times: evening, lunch and morning for a US audience (posting-time research) · bars:{" "}
          {ownReels ? `how ${ownReels} reels of ${label} did by the hour they went up` : `no scraped reels of ${label} yet`}
        </p>
      </div>
      <div className="grid grid-cols-12 gap-1">
        {windows.map((w) => {
          const h = w.lift != null ? Math.max(8, Math.round((w.lift / top) * 100)) : 0;
          const hot = w.lift != null && w.lift >= 1.2;
          return (
            <div key={w.from} className="flex flex-col items-center gap-1" title={w.lift != null ? `${w.reels} reels · ${w.lift}× usual` : `${w.reels} reels`}>
              <div className="flex h-10 w-full items-end overflow-hidden rounded bg-muted/20">
                {w.lift != null ? (
                  <div
                    className={`w-full rounded ${hot ? "bg-emerald-500/70" : w.lift < 0.8 ? "bg-rose-500/50" : "bg-sky-500/50"}`}
                    style={{ height: `${h}%` }}
                  />
                ) : (
                  <div className="h-1 w-full bg-muted/30" />
                )}
              </div>
              <span className={`text-[9px] tabular-nums ${picked.has(w.from / 2) ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                {String(w.from).padStart(2, "0")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "amber"; children: React.ReactNode }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
        tone === "amber" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : ""
      }`}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {children}
    </div>
  );
}

function ConnectionPill({
  accountId,
  connection,
  migrated,
}: {
  accountId: string;
  connection: { username: string | null; expiresAt: string | null } | null;
  migrated: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [igId, setIgId] = useState("");
  const confirmRef = useRef(false);
  if (connection) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-1 pl-3 pr-1 text-xs text-emerald-300">
        <PlatformLogo platform="instagram" className="h-3.5 w-3.5" />
        <span>
          Connected{connection.username ? ` as @${connection.username}` : ""} · posts go out by themselves
        </span>
        <button
          type="button"
          title="Disconnect"
          disabled={busy}
          onClick={async () => {
            if (!confirmRef.current) {
              confirmRef.current = true;
              toast("Click again to disconnect — planned posts will wait until it is connected again");
              setTimeout(() => (confirmRef.current = false), 5000);
              return;
            }
            setBusy(true);
            const res = await disconnectInstagram(accountId);
            setBusy(false);
            if (res.error) toast.error(res.error);
            else router.refresh();
          }}
          className="rounded-full p-1 text-emerald-300/70 hover:bg-emerald-500/20 hover:text-emerald-200"
        >
          <Unplug className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  if (!migrated) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        Waiting for the database update
      </span>
    );
  }
  const connect = async () => {
    setBusy(true);
    const res = await connectInstagram(accountId, token, igId);
    setBusy(false);
    if (res.error) return void toast.error(res.error);
    setToken("");
    setOpen(false);
    toast.success(`Connected as @${res.username} — planned posts go out by themselves now`);
    router.refresh();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-fuchsia-600 to-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90"
      >
        <PlatformLogo platform="instagram" className="h-3.5 w-3.5" /> Connect Instagram
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 space-y-2 rounded-xl border border-border/60 bg-popover p-3 shadow-xl">
          <p className="text-xs font-medium">Access token</p>
          <p className="text-[11px] text-muted-foreground">
            Meta app → Use cases → Instagram API → Generate access tokens. It is checked against this account and never shown again.
          </p>
          <Input
            inputMode="numeric"
            value={igId}
            onChange={(e) => setIgId(e.target.value.replace(/\D/g, ""))}
            placeholder="Instagram account ID (1784…)"
            className="h-8 text-xs"
          />
          <Input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && connect()}
            placeholder="Paste the token"
            className="h-8 text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={connect} disabled={busy || !token.trim()}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Connect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
