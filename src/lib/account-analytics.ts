/**
 * The numbers behind the accounts dashboard, computed from what is already
 * in the tables: one reading per reel per day (reel_metrics) and one
 * follower reading per account per day (account_metrics). Nothing here
 * touches the database; the tab hands the rows in and gets a picture back.
 *
 * Every figure is relative to a period, because "how are the accounts
 * doing" has no answer without a "since when". Views are counted as the
 * growth of the cumulative line inside the period — a reel posted a month
 * ago that gained 50k this week counts this week, which is the whole point
 * of tracking a post for days rather than reading it once.
 */

export type PeriodKey = "7d" | "30d" | "90d" | "all";
export const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

export type ReelRow = {
  account_id: string | null;
  captured_at: string;
  position: number;
  request_id: string | null;
  asset_id: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  needs_review: boolean;
  shortcode: string | null;
  posted_at: string | null;
  source: string;
};

export type MetricRow = {
  account_id: string | null;
  captured_at: string;
  followers: number | null;
  needs_review: boolean;
  source: string;
};

export type AccountInput = {
  id: string;
  handle: string;
  platform: string;
  /** Signed address of the stored profile picture, if there is one. */
  avatar?: string | null;
  /** The name set for the account here, instead of its handle. */
  label?: string | null;
};

/**
 * One colour per account, stable across every chart on the page, and the
 * platform readable from the colour alone: Instagram accounts in reds,
 * Facebook pages in blues, the biggest account the lightest shade. Ranked
 * by all-time views, so switching the period does not repaint anything.
 */
export const PLATFORM_SHADES: Record<string, string[]> = {
  instagram: ["#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337"],
  facebook: ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"],
  other: ["#d4d4d8", "#a1a1aa", "#71717a", "#52525b"],
};
export function shadeFor(platform: string, rank: number): string {
  const list = PLATFORM_SHADES[platform] ?? PLATFORM_SHADES.other;
  return list[Math.min(rank, list.length - 1)];
}
export const PLATFORM_COLOR: Record<string, string> = {
  instagram: "#e1306c",
  facebook: "#1877f2",
  tiktok: "#e5e7eb",
};

export type AccountStats = {
  id: string;
  label: string;
  platform: string;
  color: string;
  avatar: string | null;
  /** Latest follower reading, and the reading at the start of the period. */
  followers: number | null;
  followersPrev: number | null;
  /** Cumulative views today, and the gain inside this and the previous period. */
  viewsTotal: number;
  views: number;
  viewsPrev: number | null;
  /** Reels posted inside the period and the one before (scrape data only). */
  reels: number;
  reelsPrev: number | null;
  reelsTotal: number;
  avgPerReel: number | null;
  avgPerReelPrev: number | null;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number | null;
  engagementRatePrev: number | null;
  /** Views in the period per follower. 100 means the period's views were 100× the audience. */
  momentum: number | null;
};

export type Kpi = {
  key: string;
  label: string;
  /** The headline figure. */
  value: number | null;
  format: "int" | "pct" | "x";
  /** What moved inside the period, against the previous period. */
  delta: number | null;
  deltaPrev: number | null;
  deltaFormat: "int" | "pct" | "x";
  hint: string;
};

export type Analytics = {
  period: PeriodKey;
  start: number;
  end: number;
  /** When the first account was first scraped; gains are counted from here. */
  scrapeSince: number | null;
  accounts: AccountStats[];
  kpis: Kpi[];
  /** Day-by-day history for followers, avg / reel and reels in the period. */
  spark: Record<string, number[]>;
  /** The cumulative views line, one point per reading day. */
  series: {
    days: number[];
    total: number[];
    byPlatform: Record<string, number[]>;
    byAccount: Record<string, number[]>;
    /** Indices after which the line changes source and must not be joined. */
    seams: number[];
    /** Per account: the last screenshot-era index (-1 if none), and the
     *  first and last index with a reading of its own. */
    seamByAccount: Record<string, number>;
    firstByAccount: Record<string, number>;
    lastByAccount: Record<string, number>;
  };
};

const DAY = 86_400_000;
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function accountLabel(handle: string): string {
  if (!/^https?:\/\//i.test(handle)) return `@${handle}`;
  const id = handle.match(/profile\.php\?id=(\d+)/i)?.[1];
  if (id) return `Facebook …${id.slice(-4)}`;
  return handle
    .replace(/^https?:\/\/(www\.|m\.)?/i, "")
    .replace(/\/+$/, "")
    .replace(/^facebook\.com\/people\/([^/]+)\/\d+$/i, "$1 (fb)");
}

/**
 * What makes two readings the same reel. Scrape rows carry the platform's
 * id. Screenshot rows carry a match when the tile was recognised, and
 * otherwise only where it sat in the grid — a later screenshot of the same
 * grid then replaces the earlier reading of that slot rather than adding a
 * new reel to it, which is how five captures used to become five reels.
 */
function reelKey(r: ReelRow): string {
  return r.shortcode ?? r.asset_id ?? r.request_id ?? `slot${r.position}`;
}

/** Value of a step series at time t: the last point on or before t. */
function at(days: number[], values: number[], t: number): number | null {
  let v: number | null = null;
  for (let i = 0; i < days.length; i++) {
    if (days[i] <= t) v = values[i];
    else break;
  }
  return v;
}

/**
 * How much a line rose between two times, on the scrape's readings only.
 *
 * The screenshot months are a picture of whatever grid a VA happened to
 * crop that day — six tiles one morning, twelve the next — so a difference
 * between two of them is mostly a difference in the crop. They stay on the
 * chart as history but never make a number. Growth starts at the first
 * scrape; a window that ends before it has no answer, and null says so.
 */
function growth(
  days: number[],
  values: number[],
  from: number,
  to: number,
  switchAt: number | undefined
): number | null {
  const v = (t: number) => at(days, values, t) ?? 0;
  if (switchAt === undefined) return v(to) - v(from);
  const firstAfter = days.find((d) => d >= switchAt);
  if (firstAfter === undefined || to < firstAfter) return null;
  return v(to) - v(Math.max(from, firstAfter));
}

export function computeAnalytics(
  accounts: AccountInput[],
  reels: ReelRow[],
  metrics: MetricRow[],
  period: PeriodKey,
  now = Date.now()
): Analytics {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const end = now;
  const start = days ? now - days * DAY : 0;
  const prevStart = days ? start - days * DAY : 0;
  const ids = new Set(accounts.map((a) => a.id));

  const good = reels.filter(
    (r) => r.account_id && ids.has(r.account_id) && !r.needs_review && r.views != null
  );

  // The day each account was first read off its platform. Screenshot
  // readings carry an account's history up to that day, scrape readings
  // from it on; the two key reels differently and must not meet.
  const firstScrape = new Map<string, number>();
  for (const r of good) {
    if (r.source !== "scrape") continue;
    const t = new Date(r.captured_at).getTime();
    const seen = firstScrape.get(r.account_id!);
    if (seen === undefined || t < seen) firstScrape.set(r.account_id!, t);
  }
  const counts = (r: ReelRow, upto: number) => {
    const switched = firstScrape.get(r.account_id!);
    return !(r.source !== "scrape" && switched !== undefined && upto >= switched);
  };

  // ── The cumulative views line, per account, one point per reading day ──
  const dayList = Array.from(new Set(good.map((r) => dayKey(r.captured_at)))).sort();
  // Each day's point sits at the day's end — or at now for today, so the
  // headline numbers include this morning's reading instead of waiting for
  // midnight.
  const dayEnds = dayList.map((d) => Math.min(now, new Date(`${d}T23:59:59.999Z`).getTime()));
  const byAccount: Record<string, number[]> = {};
  for (const a of accounts) byAccount[a.id] = dayEnds.map(() => 0);
  const sorted = [...good].sort((x, y) => x.captured_at.localeCompare(y.captured_at));
  dayEnds.forEach((upto, di) => {
    const latest = new Map<string, { at: number; views: number; account: string }>();
    for (const r of sorted) {
      const t = new Date(r.captured_at).getTime();
      if (t > upto) break;
      if (!counts(r, upto)) continue;
      latest.set(`${r.account_id}|${reelKey(r)}`, {
        at: t,
        views: Number(r.views),
        account: r.account_id!,
      });
    }
    latest.forEach((v) => {
      byAccount[v.account][di] += v.views;
    });
  });
  // Days inside an account's run of readings where it was not read — the
  // scrape failed, or came back without views — would hold the last value
  // flat and then jump. They are filled in a straight line between the
  // readings either side, which is what the views did in between.
  const readOn = new Map<string, Set<number>>();
  for (const r of good) {
    const i = dayList.indexOf(dayKey(r.captured_at));
    const set = readOn.get(r.account_id!) ?? new Set<number>();
    set.add(i);
    readOn.set(r.account_id!, set);
  }
  readOn.forEach((set, id) => {
    const line = byAccount[id];
    if (!line) return;
    const known = Array.from(set).sort((a, b) => a - b);
    for (let k = 0; k < known.length - 1; k++) {
      const a = known[k];
      const b = known[k + 1];
      for (let i = a + 1; i < b; i++) {
        const f = (dayEnds[i] - dayEnds[a]) / Math.max(1, dayEnds[b] - dayEnds[a]);
        line[i] = Math.round(line[a] + (line[b] - line[a]) * f);
      }
    }
  });
  const total = dayEnds.map((_, i) =>
    accounts.reduce((s, a) => s + (byAccount[a.id][i] ?? 0), 0)
  );
  const byPlatform: Record<string, number[]> = {};
  for (const a of accounts) {
    const line = (byPlatform[a.platform] ??= dayEnds.map(() => 0));
    byAccount[a.id].forEach((v, i) => (line[i] += v));
  }
  // Points up to and including these indices were read off screenshots;
  // the next point is the scrape, counted on a different basis.
  const seams = new Set<number>();
  const seamByAccount: Record<string, number> = {};
  firstScrape.forEach((t, id) => {
    const i = dayEnds.findIndex((d) => d >= t);
    if (i > 0) seams.add(i - 1);
    seamByAccount[id] = i - 1;
  });
  // Where each account's own readings start and stop. A line is drawn
  // between these only, so an account nobody can read any more ends where
  // its last reading was instead of running flat to today.
  const firstByAccount: Record<string, number> = {};
  const lastByAccount: Record<string, number> = {};
  for (const r of good) {
    const i = dayList.indexOf(dayKey(r.captured_at));
    const id = r.account_id!;
    if (firstByAccount[id] === undefined || i < firstByAccount[id]) firstByAccount[id] = i;
    if (lastByAccount[id] === undefined || i > lastByAccount[id]) lastByAccount[id] = i;
  }

  // ── Latest reading per reel, for counts and engagement ──
  const latestReel = new Map<
    string,
    { account: string; views: number; likes: number; comments: number; shares: number; postedAt: number | null; scrape: boolean }
  >();
  for (const r of sorted) {
    if (!counts(r, end)) continue;
    latestReel.set(`${r.account_id}|${reelKey(r)}`, {
      account: r.account_id!,
      views: Number(r.views),
      likes: r.likes ?? 0,
      comments: r.comments ?? 0,
      shares: r.shares ?? 0,
      postedAt: r.posted_at ? new Date(r.posted_at).getTime() : null,
      scrape: r.source === "scrape",
    });
  }

  // ── Followers ──
  const followerPts = new Map<string, { t: number; v: number }[]>();
  for (const m of metrics) {
    if (!m.account_id || !ids.has(m.account_id) || m.needs_review || m.followers == null) continue;
    const list = followerPts.get(m.account_id) ?? [];
    list.push({ t: new Date(m.captured_at).getTime(), v: Number(m.followers) });
    followerPts.set(m.account_id, list);
  }
  followerPts.forEach((l) => l.sort((a, b) => a.t - b.t));
  const followersAt = (id: string, t: number): number | null => {
    const l = followerPts.get(id) ?? [];
    let v: number | null = null;
    for (const p of l) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  };

  // Shade rank per platform, by all-time views.
  const rankOf = new Map<string, number>();
  const byPlat = new Map<string, { id: string; v: number }[]>();
  for (const a of accounts) {
    const v = at(dayEnds, byAccount[a.id], end) ?? 0;
    const list = byPlat.get(a.platform) ?? [];
    list.push({ id: a.id, v });
    byPlat.set(a.platform, list);
  }
  byPlat.forEach((list) => list.sort((x, y) => y.v - x.v).forEach((x, i) => rankOf.set(x.id, i)));

  const stats: AccountStats[] = accounts.map((a) => {
    const line = byAccount[a.id];
    const switchAt = firstScrape.get(a.id);
    const vEnd = at(dayEnds, line, end) ?? 0;
    const views = days ? (growth(dayEnds, line, start, end, switchAt) ?? 0) : vEnd;
    const viewsPrev = days ? growth(dayEnds, line, prevStart, start, switchAt) : null;

    const mine = Array.from(latestReel.values()).filter((r) => r.account === a.id);
    const inPeriod = mine.filter(
      (r) => r.scrape && r.postedAt != null && r.postedAt >= start && r.postedAt < end
    );
    const inPrev = days
      ? mine.filter(
          (r) => r.scrape && r.postedAt != null && r.postedAt >= prevStart && r.postedAt < start
        )
      : null;
    const eng = (list: typeof mine) => {
      const v = list.reduce((s, r) => s + r.views, 0);
      const e = list.reduce((s, r) => s + r.likes + r.comments + r.shares, 0);
      return { views: v, eng: e, rate: v > 0 ? e / v : null };
    };
    const engNow = eng(days ? inPeriod : mine);
    const engPrev = inPrev ? eng(inPrev) : null;

    const followers = followersAt(a.id, end);
    const followersPrev = days ? followersAt(a.id, start) : null;
    const reels = days ? inPeriod.length : mine.length;
    const reelsPrev = inPrev ? inPrev.length : null;

    return {
      id: a.id,
      label: a.label || accountLabel(a.handle),
      platform: a.platform,
      color: shadeFor(a.platform, rankOf.get(a.id) ?? 0),
      avatar: a.avatar ?? null,
      followers,
      followersPrev,
      viewsTotal: vEnd,
      views,
      viewsPrev,
      reels,
      reelsPrev,
      reelsTotal: mine.length,
      // What a reel posted in the period has drawn so far, latest reading —
      // a property of the reels, not of how long the scrape has been running.
      avgPerReel: reels > 0 ? engNow.views / reels : null,
      avgPerReelPrev: engPrev && reelsPrev ? engPrev.views / reelsPrev : null,
      likes: (days ? inPeriod : mine).reduce((s, r) => s + r.likes, 0),
      comments: (days ? inPeriod : mine).reduce((s, r) => s + r.comments, 0),
      shares: (days ? inPeriod : mine).reduce((s, r) => s + r.shares, 0),
      engagementRate: engNow.rate,
      engagementRatePrev: engPrev?.rate ?? null,
      momentum: followers && followers > 0 ? views / followers : null,
    };
  });

  // ── The network ──
  const sum = (f: (s: AccountStats) => number | null) =>
    stats.reduce((acc, s) => acc + (f(s) ?? 0), 0);
  const viewsTotal = sum((s) => s.viewsTotal);
  const views = sum((s) => s.views);
  const viewsPrev =
    days && stats.some((s) => s.viewsPrev != null) ? sum((s) => s.viewsPrev) : null;
  const followers = sum((s) => s.followers);
  const followersPrev = days ? sum((s) => s.followersPrev) : null;
  const reelCount = sum((s) => s.reels);
  const reelsPrev = days ? sum((s) => s.reelsPrev) : null;
  const engViews = sum((s) => {
    // engagement is only known for scrape-era reels; weight by their views
    const list = Array.from(latestReel.values()).filter(
      (r) => r.account === s.id && r.scrape && (!days || (r.postedAt != null && r.postedAt >= start))
    );
    return list.reduce((a, r) => a + r.views, 0);
  });
  const engAll = sum((s) => s.likes + s.comments + s.shares);
  const engRate = engViews > 0 ? engAll / engViews : null;
  const engPrevViews = days
    ? Array.from(latestReel.values())
        .filter((r) => r.scrape && r.postedAt != null && r.postedAt >= prevStart && r.postedAt < start)
        .reduce((a, r) => a + r.views, 0)
    : 0;
  const engPrevAll = days
    ? Array.from(latestReel.values())
        .filter((r) => r.scrape && r.postedAt != null && r.postedAt >= prevStart && r.postedAt < start)
        .reduce((a, r) => a + r.likes + r.comments + r.shares, 0)
    : 0;
  const engRatePrev = days && engPrevViews > 0 ? engPrevAll / engPrevViews : null;

  const kpis: Kpi[] = [
    {
      key: "views",
      label: "Total views",
      value: viewsTotal,
      format: "int",
      delta: days ? views : null,
      deltaPrev: viewsPrev,
      deltaFormat: "int",
      hint: "all reels, latest reading",
    },
    {
      key: "followers",
      label: "Followers",
      value: followers,
      format: "int",
      delta: days && followersPrev != null ? followers - followersPrev : null,
      deltaPrev: null,
      deltaFormat: "int",
      hint: "posting accounts",
    },
    {
      key: "avg",
      label: "Avg / reel",
      value: reelCount > 0 ? sum((s) => s.avgPerReel == null ? 0 : s.avgPerReel * s.reels) / reelCount : null,
      format: "int",
      delta: null,
      deltaPrev:
        reelsPrev && reelsPrev > 0
          ? sum((s) => s.avgPerReelPrev == null || s.reelsPrev == null ? 0 : s.avgPerReelPrev * s.reelsPrev) / reelsPrev
          : null,
      deltaFormat: "int",
      hint: days ? "views of reels posted in the period" : "views ÷ reels",
    },
    {
      key: "reels",
      label: "Reels",
      value: reelCount,
      format: "int",
      delta: null,
      deltaPrev: reelsPrev,
      deltaFormat: "int",
      hint: days ? "posted in the period" : "on the accounts",
    },
    {
      key: "engagement",
      label: "Engagement",
      value: engRate,
      format: "pct",
      delta: null,
      deltaPrev: engRatePrev,
      deltaFormat: "pct",
      hint: "likes + comments + shares ÷ views",
    },
  ];

  // ── A day-by-day history per figure, for the small curves on the tiles ──
  // Followers: what the accounts had at each day's end (an account read
  // only later counts with its first reading, so its arrival is no jump).
  // Avg / reel and reels: over the reels posted from the period's start up
  // to that day, so the curve ends on the tile's own figure.
  const sparkDays = dayEnds.filter((d) => d >= start);
  const firstFollowers = (id: string) => followerPts.get(id)?.[0]?.v ?? null;
  const inNet = new Set(stats.map((x) => x.id));
  const periodReels = Array.from(latestReel.values()).filter(
    (r) => inNet.has(r.account) && r.scrape && r.postedAt != null && (!days || r.postedAt >= start)
  );
  const spark: Record<string, number[]> = {
    followers: sparkDays.map((d) =>
      stats.reduce((acc, x) => acc + (followersAt(x.id, d) ?? firstFollowers(x.id) ?? 0), 0)
    ),
    avg: sparkDays.map((d) => {
      const upTo = periodReels.filter((r) => r.postedAt! <= d);
      // No reel yet: no point, so the curve starts with the first reel.
      return upTo.length ? upTo.reduce((a, r) => a + r.views, 0) / upTo.length : NaN;
    }),
    reels: sparkDays.map((d) => periodReels.filter((r) => r.postedAt! <= d).length),
  };

  let scrapeSince: number | null = null;
  firstScrape.forEach((t) => {
    if (scrapeSince === null || t < scrapeSince) scrapeSince = t;
  });

  return {
    period,
    start,
    end,
    scrapeSince,
    accounts: stats.sort((a, b) => b.views - a.views),
    kpis,
    spark,
    series: {
      days: dayEnds,
      total,
      byPlatform,
      byAccount,
      seams: Array.from(seams).sort((a, b) => a - b),
      seamByAccount,
      firstByAccount,
      lastByAccount,
    },
  };
}

/** 429090 → "429k", 1234 → "1.2k", 87 → "87". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: string) => v.replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))}M`;
  if (abs >= 1_000) return `${trim((n / 1_000).toFixed(abs >= 10_000 ? 0 : 1))}k`;
  return Math.round(n).toString();
}

/** A tick step that lands on round numbers: 1, 2, 2.5, 5 × a power of ten. */
export function niceStep(max: number, ticks = 5): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => max / v <= ticks) ?? mag;
}

/** Change of `now` against `prev`, as a fraction; null when there is nothing to compare with. */
export function change(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || prev === 0) return null;
  return (now - prev) / Math.abs(prev);
}
