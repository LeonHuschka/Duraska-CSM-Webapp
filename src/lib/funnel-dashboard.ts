import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * The link-in-bio page's numbers for the dashboard, computed from the
 * event rows: what people did in the period, against the period before.
 * Bots are counted separately and never mixed into the people figures.
 */
export type Period = 7 | 30 | 90;

type Ev = {
  kind: string;
  bot: boolean;
  reason: string | null;
  country: string | null;
  referrer: string | null;
  in_app: boolean;
  platform: string | null;
  created_at: string;
};

export type FunnelDashboard = {
  days: Period;
  views: number;
  clicks: number;
  ctr: number | null;
  inApp: number;
  prev: { views: number; clicks: number; ctr: number | null };
  bots: number;
  canary: number;
  blockedCountry: number;
  botReasons: [string, number][];
  /** One point per day: [dayStart ms, views, clicks]. */
  daily: [number, number, number][];
  /** 24 buckets, UTC, people only: [views, clicks]. */
  hourly: [number, number][];
  /** ISO-2 → views (people only), for the map. */
  countries: Record<string, { views: number; clicks: number }>;
  sources: [string, number][];
  platforms: [string, number][];
  last: { kind: string; bot: boolean; country: string | null; platform: string | null; in_app: boolean; at: string; reason: string | null }[];
};

export async function funnelDashboard(
  supabase: SupabaseClient<Database>,
  pageId: string,
  days: Period
): Promise<FunnelDashboard> {
  const DAY = 86_400_000;
  const now = Date.now();
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  const { data } = await supabase
    .from("funnel_events")
    .select("kind, bot, reason, country, referrer, in_app, platform, created_at")
    .eq("page_id", pageId)
    .gte("created_at", new Date(prevStart).toISOString())
    .order("created_at", { ascending: false })
    .limit(50_000);
  const rows: Ev[] = data ?? [];
  const t = (e: Ev) => new Date(e.created_at).getTime();
  const cur = rows.filter((e) => t(e) >= start);
  const prev = rows.filter((e) => t(e) < start);
  const people = cur.filter((e) => !e.bot);
  const count = (list: Ev[], kind: string) => list.filter((e) => !e.bot && e.kind === kind).length;
  const ctr = (v: number, c: number) => (v > 0 ? c / v : null);

  const views = count(cur, "view");
  const clicks = count(cur, "click");
  const pv = count(prev, "view");
  const pc = count(prev, "click");

  // Daily, oldest first, every day present so the line has no gaps.
  const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
  const daily = new Map<number, [number, number]>();
  for (let d = dayStart(start); d <= dayStart(now); d += DAY) daily.set(d, [0, 0]);
  for (const e of people) {
    const b = daily.get(dayStart(t(e)));
    if (!b) continue;
    if (e.kind === "view") b[0]++;
    else if (e.kind === "click") b[1]++;
  }
  const hourly: [number, number][] = Array.from({ length: 24 }, () => [0, 0]);
  for (const e of people) {
    const h = new Date(e.created_at).getUTCHours();
    if (e.kind === "view") hourly[h][0]++;
    else if (e.kind === "click") hourly[h][1]++;
  }
  const countries: Record<string, { views: number; clicks: number }> = {};
  for (const e of people) {
    if (!e.country) continue;
    const c = (countries[e.country] ??= { views: 0, clicks: 0 });
    if (e.kind === "view") c.views++;
    else if (e.kind === "click") c.clicks++;
  }
  const tally = (f: (e: Ev) => string | null, list = people) => {
    const m = new Map<string, number>();
    for (const e of list) {
      const k = f(e);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const sourceOf = (e: Ev) => {
    if (e.kind !== "view") return null;
    if (e.in_app) return "Instagram app";
    if (!e.referrer) return "Direct / typed";
    try {
      const h = new URL(e.referrer).hostname.replace(/^www\./, "");
      if (/instagram\.com|l\.instagram/.test(h)) return "Instagram";
      if (/threads/.test(h)) return "Threads";
      if (/tiktok/.test(h)) return "TikTok";
      if (/facebook|fb\.com|l\.facebook/.test(h)) return "Facebook";
      return h;
    } catch {
      return "Direct / typed";
    }
  };

  return {
    days,
    views,
    clicks,
    ctr: ctr(views, clicks),
    inApp: people.filter((e) => e.kind === "view" && e.in_app).length,
    prev: { views: pv, clicks: pc, ctr: ctr(pv, pc) },
    bots: cur.filter((e) => e.bot).length,
    canary: cur.filter((e) => e.kind === "canary").length,
    blockedCountry: cur.filter((e) => e.kind === "blocked" && !e.bot).length,
    botReasons: tally((e) => (e.bot ? e.reason ?? "bot" : null), cur).slice(0, 6),
    daily: Array.from(daily.entries()).map(([d, [v, c]]) => [d, v, c] as [number, number, number]),
    hourly,
    countries,
    sources: tally(sourceOf).slice(0, 8),
    platforms: tally((e) => (e.kind === "view" ? e.platform ?? "other" : null)),
    last: cur.slice(0, 12).map((e) => ({ kind: e.kind, bot: e.bot, country: e.country, platform: e.platform, in_app: e.in_app, at: e.created_at, reason: e.reason })),
  };
}

/** Latest follower reading summed over the persona's posting accounts. */
export async function totalFollowers(supabase: SupabaseClient<Database>, personaId: string): Promise<number | null> {
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, posts_per_day")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")');
  const ids = (accounts ?? []).filter((a) => Number(a.posts_per_day ?? 0) > 0).map((a) => a.id);
  if (ids.length === 0) return null;
  const { data: metrics } = await supabase
    .from("account_metrics")
    .select("account_id, followers, captured_at")
    .in("account_id", ids)
    .not("followers", "is", null)
    .order("captured_at", { ascending: false })
    .limit(500);
  const latest = new Map<string, number>();
  for (const m of metrics ?? []) {
    if (m.account_id && !latest.has(m.account_id)) latest.set(m.account_id, Number(m.followers));
  }
  if (latest.size === 0) return null;
  let sum = 0;
  latest.forEach((v) => (sum += v));
  return sum;
}
