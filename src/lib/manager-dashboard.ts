import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { computeAnalytics } from "@/lib/account-analytics";
import { selectAll } from "@/lib/select-all";
import { berlinDay } from "@/lib/berlin-day";
import { ofDaily, ofPeriod, omConfigured, onlyFansAccount, type OfDay } from "@/lib/onlymonster";

/**
 * What a manager reads off the Pipeline tab, beyond the pipeline itself:
 * the chain from a reel's views to a fan on OnlyFans, and every stock with
 * the line it drew over the last month.
 *
 * Days are UTC days here, because the link page and OnlyMonster both count
 * in UTC; a rate across two sources has to cut its days in the same place.
 * The week of work further down counts in Berlin days, the team's.
 */

const DAY = 86_400_000;
const SPARK_DAYS = 30;
export const HISTORY_DAYS = 90;

export type Total = { value: number | null; spark: number[]; note?: string };

export type FlowDay = {
  /** UTC day start, ms. */
  day: number;
  /** Views the posting accounts' reels gained that day; null before any reading. */
  igViews: number | null;
  /** People on the landing page (page 1). */
  visits: number;
  /** People who reached the real page (page 2). */
  opened: number;
  /** People sent on to OnlyFans. */
  clicks: number;
  /** New OnlyFans fans; null when OnlyFans is not connected or the day was not read. */
  newFans: number | null;
  revenue: number | null;
};

export type ConversionKey = "visit" | "click" | "fan";
export type Conversion = {
  key: ConversionKey;
  label: string;
  from: string;
  to: string;
  rate: number | null;
  prev: number | null;
  num: number;
  den: number;
  /** The 7-day rate for each of the last 30 days. */
  spark: number[];
};

export type ManagerData = {
  totals: {
    live: Total;
    posted: Total;
    inspo: Total;
    toEdit: Total;
    ready: Total;
    views: Total;
    followers: Total;
    fans: Total;
  };
  conversions: Conversion[];
  flow: FlowDay[];
  of: { connected: boolean; found: boolean };
  extras: {
    bufferDays: number | null;
    perDay: number;
    revenue7: number | null;
    revenuePrev7: number | null;
    newSpenders7: number | null;
    fanToSpender7: number | null;
    viewsPerPost7: number | null;
    viewsPerPostPrev7: number | null;
    revenuePerClick7: number | null;
  };
};

const utcDay = (t: number) => Math.floor(t / DAY) * DAY;
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

/** Sum of a field over the days in [from, to), skipping days without a value. */
function sumOver(flow: FlowDay[], from: number, to: number, f: (d: FlowDay) => number | null) {
  let s = 0;
  let any = false;
  for (const d of flow) {
    if (d.day < from || d.day >= to) continue;
    const v = f(d);
    if (v == null) continue;
    s += v;
    any = true;
  }
  return any ? s : null;
}

const RATES: Record<ConversionKey, { label: string; from: string; to: string; num: (d: FlowDay) => number | null; den: (d: FlowDay) => number | null }> = {
  visit: { label: "Views → landing page", from: "reel views", to: "visits", num: (d) => d.visits, den: (d) => d.igViews },
  click: { label: "Landing page → link click", from: "visits", to: "clicks", num: (d) => d.clicks, den: (d) => Math.max(d.visits, d.opened) },
  fan: { label: "OnlyFans visit → fan", from: "sent to OF", to: "new fans", num: (d) => d.newFans, den: (d) => (d.newFans == null ? null : d.clicks) },
};

/** The rate over the seven days ending with (and including) the day `end` starts. */
export function rateOver(flow: FlowDay[], key: ConversionKey, endDay: number, days = 7) {
  const r = RATES[key];
  const from = endDay - (days - 1) * DAY;
  const n = sumOver(flow, from, endDay + DAY, r.num);
  const d = sumOver(flow, from, endDay + DAY, r.den);
  return n == null || d == null ? null : ratio(n, d);
}

export async function managerData(
  supabase: SupabaseClient<Database>,
  personaId: string,
  pipe: {
    reqs: { id: string; status: string; is_nsfw: boolean; shooted_at: string | null }[];
    links: { status: string; posted_at: string | null; shot_at: string | null }[];
    firstRaw: Map<string, number>;
    firstEdited: Map<string, number>;
    firstPosted: Map<string, number>;
    editedCuts: { id: string; request_id: string | null }[];
    postedTimes: number[];
    perDay: number;
  }
): Promise<ManagerData> {
  const now = Date.now();
  const today = utcDay(now);
  const sparkEnds = Array.from({ length: SPARK_DAYS }, (_, i) => Math.min(now, today + DAY - 1 - (SPARK_DAYS - 1 - i) * DAY));
  const since = new Date(today - (HISTORY_DAYS + 7) * DAY).toISOString();

  // ── Accounts, their readings, and the link page ──
  const [{ data: accounts }, reels, metrics, { data: page }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, handle, display_name, platform, status, posts_per_day, created_at")
      .eq("persona_id", personaId),
    selectAll((a, b) =>
      supabase
        .from("reel_metrics")
        .select("id, account_id, captured_at, position, request_id, asset_id, views, likes, comments, shares, needs_review, shortcode, posted_at, source")
        .eq("persona_id", personaId)
        .order("captured_at", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b)
    ),
    selectAll((a, b) =>
      supabase
        .from("account_metrics")
        .select("id, account_id, captured_at, followers, needs_review, source")
        .eq("persona_id", personaId)
        .order("captured_at", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b)
    ),
    supabase
      .from("funnel_pages")
      .select("id, slug, ignored_countries, destination_url")
      .eq("persona_id", personaId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const live = (accounts ?? []).filter((a) => a.status !== "dead" && a.status !== "paused");
  const posting = live.filter((a) => Number(a.posts_per_day ?? 0) > 0);
  const analytics = computeAnalytics(
    posting.map((a) => ({ id: a.id, handle: a.handle, platform: a.platform, label: a.display_name })),
    reels,
    metrics,
    "90d",
    now
  );

  // Views gained per UTC day: each account's rise from the day before, and
  // only once it was read the day before — an account's first reading is
  // its whole history, not one day's views.
  const igByDay = new Map<number, number>();
  const s = analytics.series;
  for (let i = 1; i < s.days.length; i++) {
    let gained = 0;
    for (const a of posting) {
      const line = s.byAccount[a.id];
      const first = s.firstByAccount[a.id];
      const last = s.lastByAccount[a.id];
      if (!line || first === undefined || first < 0 || i - 1 < first || i > last) continue;
      if (s.seamByAccount[a.id] === i - 1) continue;
      gained += Math.max(0, line[i] - line[i - 1]);
    }
    igByDay.set(utcDay(s.days[i]), gained);
  }

  // ── The link page, per day ──
  const funnel = page
    ? await supabase.rpc("funnel_daily", {
        p_page: page.id,
        p_since: since,
        p_skip: (page.ignored_countries ?? []).map((c: string) => c.toUpperCase()),
      })
    : { data: [] };
  const funnelByDay = new Map(
    (funnel.data ?? []).map((r) => [new Date(`${r.day}T00:00:00Z`).getTime(), r] as const)
  );

  // ── OnlyFans, per day ──
  const connected = omConfigured();
  const ofUser = page?.destination_url?.match(/onlyfans\.com\/([A-Za-z0-9_.-]+)/i)?.[1] ?? null;
  const ofAcc = connected ? await onlyFansAccount(ofUser) : null;
  const [ofDays, ofYear] = ofAcc
    ? await Promise.all([
        ofDaily(ofAcc.platform_account_id, HISTORY_DAYS),
        ofPeriod(ofAcc.platform_account_id, today - 364 * DAY, today + DAY - 1),
      ])
    : [[] as OfDay[], null];
  const ofByDay = new Map(ofDays.map((d) => [d.day, d]));

  const flow: FlowDay[] = Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const day = today - (HISTORY_DAYS - 1 - i) * DAY;
    const f = funnelByDay.get(day);
    const o = ofByDay.get(day);
    return {
      day,
      igViews: igByDay.has(day) ? igByDay.get(day)! : null,
      visits: f?.gate_views ?? 0,
      opened: f?.opened ?? 0,
      clicks: f?.clicks ?? 0,
      newFans: o ? o.newFans : null,
      revenue: o ? o.revenue : null,
    };
  });

  // ── Conversions: the last seven days against the seven before ──
  const conversions: Conversion[] = (Object.keys(RATES) as ConversionKey[]).map((key) => {
    const r = RATES[key];
    const from = today - 6 * DAY;
    return {
      key,
      label: r.label,
      from: r.from,
      to: r.to,
      rate: rateOver(flow, key, today),
      prev: rateOver(flow, key, today - 7 * DAY),
      num: sumOver(flow, from, today + DAY, r.num) ?? 0,
      den: sumOver(flow, from, today + DAY, r.den) ?? 0,
      spark: sparkEnds.map((t) => rateOver(flow, key, utcDay(t)) ?? NaN),
    };
  });

  // ── Stocks, and the line each drew ──
  const createdAt = new Map(live.map((a) => [a.id, new Date(a.created_at).getTime()]));
  const liveSpark = sparkEnds.map((t) => live.filter((a) => (createdAt.get(a.id) ?? 0) <= t).length);

  const postedSorted = [...pipe.postedTimes].sort((a, b) => a - b);
  const postedSpark = sparkEnds.map((t) => postedSorted.filter((x) => x <= t).length);

  const inspoAt = (t: number) =>
    pipe.links.filter((l) => {
      if (!l.posted_at || new Date(l.posted_at).getTime() > t) return false;
      if (l.status === "open") return true;
      return !!l.shot_at && new Date(l.shot_at).getTime() > t;
    }).length;

  const hasRaw = (id: string) => pipe.firstRaw.has(id);
  const toEditAt = (t: number) =>
    pipe.reqs.filter((r) => {
      const raw = pipe.firstRaw.get(r.id);
      if (raw === undefined || raw > t) return false;
      const cut = pipe.firstEdited.get(r.id);
      return cut === undefined || cut > t;
    }).length;

  // Fresh = cut, SFW, and not out on any account yet.
  const fresh = (r: { id: string; is_nsfw: boolean; status: string }, t: number) => {
    if (r.is_nsfw || r.status === "archived") return false;
    const cut = pipe.firstEdited.get(r.id);
    if (cut === undefined || cut > t) return false;
    const out = pipe.firstPosted.get(r.id);
    return out === undefined || out > t;
  };
  const freshNow = pipe.reqs.filter((r) => fresh(r, now));
  const freshIds = new Set(freshNow.map((r) => r.id));
  const freshCuts = pipe.editedCuts.filter((c) => c.request_id && freshIds.has(c.request_id)).length;

  const followersKpi = analytics.kpis.find((k) => k.key === "followers");
  const viewsKpi = analytics.kpis.find((k) => k.key === "views");
  const followerSpark = analytics.spark.followers.slice(-SPARK_DAYS);
  const totalSeries = s.days.map((d, i) => [d, s.total[i]] as const);
  const viewsSpark = sparkEnds.map((t) => {
    let v = NaN;
    for (const [d, total] of totalSeries) if (d <= t) v = total;
    return v;
  });

  let fansRunning = 0;
  const fansSpark = ofDays.length
    ? sparkEnds.map((t) => {
        fansRunning = ofDays.filter((d) => d.day <= t && d.day > today - SPARK_DAYS * DAY).reduce((a, d) => a + d.newFans, 0);
        return fansRunning;
      })
    : [];

  // ── The smaller figures ──
  const wkFrom = today - 6 * DAY;
  const prevFrom = today - 13 * DAY;
  const revenue7 = sumOver(flow, wkFrom, today + DAY, (d) => d.revenue);
  const revenuePrev7 = sumOver(flow, prevFrom, wkFrom, (d) => d.revenue);
  const fans7 = sumOver(flow, wkFrom, today + DAY, (d) => d.newFans);
  const newSpenders7 = ofDays.length
    ? ofDays.filter((d) => d.day >= wkFrom).reduce((a, d) => a + d.newSpenders, 0)
    : null;
  const clicks7 = sumOver(flow, wkFrom, today + DAY, (d) => d.clicks) ?? 0;
  const views7 = sumOver(flow, wkFrom, today + DAY, (d) => d.igViews);
  const viewsPrev7 = sumOver(flow, prevFrom, wkFrom, (d) => d.igViews);
  const posts7 = postedSorted.filter((t) => t >= wkFrom).length;
  const postsPrev7 = postedSorted.filter((t) => t >= prevFrom && t < wkFrom).length;

  return {
    totals: {
      live: { value: live.length, spark: liveSpark, note: `${posting.length} posting` },
      posted: { value: postedSorted.length, spark: postedSpark },
      inspo: { value: pipe.links.filter((l) => l.status === "open").length, spark: sparkEnds.map(inspoAt) },
      toEdit: {
        value: pipe.reqs.filter((r) => r.status === "shooted" && hasRaw(r.id)).length,
        spark: sparkEnds.map(toEditAt),
      },
      ready: {
        value: freshNow.length,
        spark: sparkEnds.map((t) => pipe.reqs.filter((r) => fresh(r, t)).length),
        note: `${freshCuts} cuts`,
      },
      views: { value: viewsKpi?.value ?? null, spark: viewsSpark },
      followers: { value: followersKpi?.value ?? null, spark: followerSpark },
      fans: { value: ofYear?.fans ?? null, spark: fansSpark },
    },
    conversions,
    flow,
    of: { connected, found: !!ofAcc },
    extras: {
      bufferDays: pipe.perDay > 0 ? freshCuts / pipe.perDay : null,
      perDay: pipe.perDay,
      revenue7,
      revenuePrev7,
      newSpenders7,
      fanToSpender7: newSpenders7 != null && fans7 ? newSpenders7 / fans7 : null,
      viewsPerPost7: views7 != null && posts7 > 0 ? views7 / posts7 : null,
      viewsPerPostPrev7: viewsPrev7 != null && postsPrev7 > 0 ? viewsPrev7 / postsPrev7 : null,
      revenuePerClick7: revenue7 != null && clicks7 > 0 ? revenue7 / clicks7 : null,
    },
  };
}

/** The last seven Berlin days of work: shot, cut and posted per day. */
export function weekOfWork(
  reqs: { id: string; shooted_at: string | null }[],
  firstEdited: Map<string, number>,
  postedTimes: number[]
) {
  const days = Array.from({ length: 7 }, (_, i) => berlinDay(new Date(Date.now() - (6 - i) * DAY)));
  const count = (times: number[]) => {
    const m = new Map<string, number>();
    for (const t of times) {
      const k = berlinDay(new Date(t));
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const shot = count(reqs.filter((r) => r.shooted_at).map((r) => new Date(r.shooted_at!).getTime()));
  const cut = count(Array.from(firstEdited.values()));
  const posted = count(postedTimes);
  return days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return {
      label: `${dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${dt.getUTCDate()}`,
      shot: shot.get(d) ?? 0,
      edited: cut.get(d) ?? 0,
      posted: posted.get(d) ?? 0,
    };
  });
}
