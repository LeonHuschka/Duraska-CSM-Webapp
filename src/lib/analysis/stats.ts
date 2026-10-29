/**
 * The counting behind Analysis. Plain statistics, no model: a feature is
 * worth telling the creator about only when it shows up in winners clearly
 * more often than in the reels that were not winners, more often than chance
 * would make it look over a hundred-odd features.
 *
 * - One account: Fisher's exact test, winners against the rest (losers and
 *   the control sample), per feature.
 * - All accounts: Cochran–Mantel–Haenszel across accounts, so a feature that
 *   only one big account wears cannot pass as general; plus how many
 *   accounts point the same way.
 * - Over time: the same winner-against-rest gap in the older and the newer
 *   half, to see what is rising and what is wearing off.
 * Every p-value is corrected with Benjamini–Hochberg (q), because over many
 * features some always look "significant" by accident.
 */

export type Cohort = "winner" | "loser" | "control";
export type StatReel = {
  id: string;
  shortcode: string;
  accountId: string;
  cohort: Cohort;
  lift: number | null;
  postedAt: string | null;
  keys: Set<string>;
};

export type Confidence = "strong" | "medium" | "weak";
export type Finding = {
  key: string;
  winners: { k: number; n: number };
  rest: { k: number; n: number };
  losers: { k: number; n: number };
  /** Median lift of the analysed reels with and without the feature. */
  liftWith: number | null;
  liftWithout: number | null;
  /** How many times more often winners have it than the rest (smoothed). */
  ratio: number;
  p: number;
  q: number;
  confidence: Confidence | null;
  /** Accounts where winners have it more often than the rest, of those that could tell. */
  accounts?: { agree: number; total: number };
  /** Winners that show it, for the page to link. */
  examples: string[];
  /** The pattern it belongs to: findings with the same letter rest on the same winners. */
  pattern?: string;
};

export type Pattern = { label: string; winners: string[]; findings: number };

export type TimeFinding = {
  key: string;
  trend: "rising" | "fading" | "steady";
  before: { gap: number; winners: number; n: number };
  recent: { gap: number; winners: number; n: number };
};

export type ScopeStats = {
  reels: number;
  winners: number;
  losers: number;
  controls: number;
  positive: Finding[];
  negative: Finding[];
  combos: Finding[];
  /** Older runs have none. */
  patterns?: Pattern[];
};

// ── distributions ──

const logFact = (() => {
  const cache = [0];
  return (n: number) => {
    for (let i = cache.length; i <= n; i++) cache[i] = cache[i - 1] + Math.log(i);
    return cache[n];
  };
})();

/** Two-sided Fisher's exact test on [[a, b], [c, d]]. */
export function fisher(a: number, b: number, c: number, d: number): number {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const logP = (x: number) =>
    logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1) - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(r2 - c1 + x);
  const observed = logP(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

/** Complementary error function (Numerical Recipes), for the χ² tail. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** Cochran–Mantel–Haenszel over 2×2 tables [a, b, c, d] (one per account), with continuity correction. */
export function cmh(tables: [number, number, number, number][]): number {
  let sumA = 0, sumE = 0, sumV = 0;
  for (const [a, b, c, d] of tables) {
    const n = a + b + c + d;
    if (n < 2) continue;
    const r1 = a + b, c1 = a + c;
    sumA += a;
    sumE += (r1 * c1) / n;
    sumV += (r1 * (c + d) * c1 * (b + d)) / (n * n * (n - 1));
  }
  if (sumV <= 0) return 1;
  const chi = Math.max(0, Math.abs(sumA - sumE) - 0.5) ** 2 / sumV;
  return erfc(Math.sqrt(chi / 2));
}

/**
 * Benjamini–Hochberg q-values, in the order given. `family` is how many
 * tests there could have been: when only the promising ones were run, the
 * rest count as tests that found nothing, which keeps a hand-picked shortlist
 * from looking better than it is.
 */
export function bh(ps: number[], family = ps.length): number[] {
  const m = Math.max(family, ps.length);
  const order = ps.map((p, i) => [p, i] as const).sort((x, y) => x[0] - y[0]);
  const q = new Array<number>(ps.length);
  let min = 1;
  for (let r = order.length - 1; r >= 0; r--) {
    const [p, i] = order[r];
    min = Math.min(min, (p * m) / (r + 1));
    q[i] = min;
  }
  return q;
}

const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

function confidence(f: { p: number; q: number; winners: { k: number } }): Confidence | null {
  if (f.q < 0.1 && f.winners.k >= 4) return "strong";
  // A small account tests sixty features on five winners; p alone lets chance through.
  if (f.p < 0.05 && f.q < 0.3 && f.winners.k >= 3) return "medium";
  if (f.p < 0.2 && f.winners.k >= 2) return "weak";
  return null;
}

// ── comparisons ──

/** Features seen often enough in this set of reels to be worth a test. */
function candidateKeys(reels: StatReel[], minSupport: number): string[] {
  const count = new Map<string, number>();
  for (const r of reels) r.keys.forEach((k) => count.set(k, (count.get(k) ?? 0) + 1));
  return Array.from(count.entries())
    .filter(([, n]) => n >= minSupport && n <= reels.length - 1)
    .map(([k]) => k);
}

function finding(reels: StatReel[], key: string, has: (r: StatReel) => boolean, p: number): Finding {
  const winners = reels.filter((r) => r.cohort === "winner");
  const rest = reels.filter((r) => r.cohort !== "winner");
  const losers = reels.filter((r) => r.cohort === "loser");
  const kW = winners.filter(has).length;
  const kR = rest.filter(has).length;
  const with_ = reels.filter(has).map((r) => r.lift ?? NaN);
  const without = reels.filter((r) => !has(r)).map((r) => r.lift ?? NaN);
  // Add-one smoothing keeps 3/3 against 0/10 from reading as infinite.
  const ratio = ((kW + 0.5) / (winners.length + 1)) / ((kR + 0.5) / (rest.length + 1));
  return {
    key,
    winners: { k: kW, n: winners.length },
    rest: { k: kR, n: rest.length },
    losers: { k: losers.filter(has).length, n: losers.length },
    liftWith: median(with_),
    liftWithout: median(without),
    ratio,
    p,
    q: 1,
    confidence: null,
    examples: winners.filter(has).map((r) => r.id),
  };
}

function table(reels: StatReel[], has: (r: StatReel) => boolean): [number, number, number, number] {
  let a = 0, b = 0, c = 0, d = 0;
  for (const r of reels) {
    const h = has(r);
    if (r.cohort === "winner") {
      if (h) a++;
      else b++;
    } else if (h) c++;
    else d++;
  }
  return [a, b, c, d];
}

function finish(list: Finding[], family?: number): Finding[] {
  const q = bh(list.map((f) => f.p), family);
  list.forEach((f, i) => {
    f.q = q[i];
    f.confidence = confidence(f);
  });
  return list;
}

/**
 * Winners against the rest in one set of reels. `byAccount` makes it the
 * cross-account comparison: stratified test and the agreement count.
 */
export function compare(reels: StatReel[], opts: { byAccount?: boolean; minSupport?: number } = {}): ScopeStats {
  const minSupport = opts.minSupport ?? 3;
  const winners = reels.filter((r) => r.cohort === "winner").length;
  const base: ScopeStats = {
    reels: reels.length,
    winners,
    losers: reels.filter((r) => r.cohort === "loser").length,
    controls: reels.filter((r) => r.cohort === "control").length,
    positive: [],
    negative: [],
    combos: [],
  };
  if (winners === 0 || winners === reels.length) return base;

  const accounts = opts.byAccount ? Array.from(new Set(reels.map((r) => r.accountId))) : [];
  const test = (has: (r: StatReel) => boolean) => {
    if (!opts.byAccount) return fisher(...table(reels, has));
    return cmh(accounts.map((a) => table(reels.filter((r) => r.accountId === a), has)));
  };
  const agreement = (has: (r: StatReel) => boolean) => {
    let agree = 0, total = 0;
    for (const a of accounts) {
      const [w1, w0, r1, r0] = table(reels.filter((r) => r.accountId === a), has);
      if (w1 + w0 === 0 || r1 + r0 === 0 || w1 + r1 === 0) continue;
      total++;
      if (w1 / (w1 + w0) > r1 / (r1 + r0)) agree++;
    }
    return { agree, total };
  };

  const candidates = candidateKeys(reels, minSupport);
  const singles = finish(
    candidates.map((key) => {
      const has = (r: StatReel) => r.keys.has(key);
      const f = finding(reels, key, has, test(has));
      if (opts.byAccount) f.accounts = agreement(has);
      return f;
    })
  );
  base.positive = singles.filter((f) => f.ratio > 1 && f.confidence).sort((a, b) => a.p - b.p || b.ratio - a.ratio);
  base.negative = singles
    .filter((f) => f.ratio < 1 && f.p < 0.1 && f.rest.k >= minSupport)
    .sort((a, b) => a.p - b.p);

  // Pairs of the most promising features: what works together.
  const top = singles
    .filter((f) => f.ratio > 1 && f.winners.k >= 2)
    .sort((a, b) => a.p - b.p)
    .slice(0, 14)
    .map((f) => f.key);
  const pairs: Finding[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const [x, y] = [top[i], top[j]];
      const has = (r: StatReel) => r.keys.has(x) && r.keys.has(y);
      const support = reels.filter(has).length;
      if (support < minSupport) continue;
      const f = finding(reels, `${x} + ${y}`, has, test(has));
      if (opts.byAccount) f.accounts = agreement(has);
      pairs.push(f);
    }
  }
  // The pairs were picked from the best singles, so correct over every pair that could have been tried.
  const allPairs = (candidates.length * (candidates.length - 1)) / 2;
  base.combos = finish(pairs, allPairs)
    .filter((f) => f.ratio > 1 && f.confidence && f.winners.k >= 3)
    .sort((a, b) => a.p - b.p)
    .slice(0, 8);
  base.patterns = groupByWinners([...base.positive, ...base.combos]);
  return base;
}

/**
 * Findings that rest on the same winners are one observation, not several:
 * five reels of one look carry its colour, its pose and its place all at
 * once. Each finding joins the first pattern whose winners it largely
 * shares (Jaccard ≥ SAME_WINNERS), strongest findings first.
 */
const SAME_WINNERS = 0.6;
function groupByWinners(findings: Finding[]): Pattern[] {
  const patterns: (Pattern & { set: Set<string> })[] = [];
  const order = [...findings].sort((a, b) => a.p - b.p);
  for (const f of order) {
    const mine = new Set(f.examples);
    if (mine.size < 2) continue;
    const home = patterns.find((p) => {
      let both = 0;
      mine.forEach((id) => {
        if (p.set.has(id)) both++;
      });
      return both / (mine.size + p.set.size - both) >= SAME_WINNERS;
    });
    if (home) {
      home.findings++;
      f.pattern = home.label;
    } else {
      const label = String.fromCharCode(65 + patterns.length);
      patterns.push({ label, winners: Array.from(mine), findings: 1, set: mine });
      f.pattern = label;
    }
  }
  return patterns.map(({ label, winners, findings }) => ({ label, winners, findings }));
}

/**
 * Older against newer: for the features that matter overall, the share of
 * winners against the share of the rest that show it, in each half.
 */
export function overTime(reels: StatReel[], keys: string[], splitAt: string): TimeFinding[] {
  const older = reels.filter((r) => r.postedAt && r.postedAt < splitAt);
  const newer = reels.filter((r) => r.postedAt && r.postedAt >= splitAt);
  const gap = (set: StatReel[], key: string) => {
    const w = set.filter((r) => r.cohort === "winner");
    const rest = set.filter((r) => r.cohort !== "winner");
    const pw = w.length ? w.filter((r) => r.keys.has(key)).length / w.length : 0;
    const pr = rest.length ? rest.filter((r) => r.keys.has(key)).length / rest.length : 0;
    return { gap: pw - pr, winners: w.filter((r) => r.keys.has(key)).length, n: w.length };
  };
  return keys
    .map((key) => {
      const before = gap(older, key);
      const recent = gap(newer, key);
      const trend: TimeFinding["trend"] =
        recent.gap - before.gap >= 0.2 ? "rising" : before.gap - recent.gap >= 0.2 ? "fading" : "steady";
      return { key, trend, before, recent };
    })
    .filter((t) => t.before.n > 0 && t.recent.n > 0);
}

/** The posting date that splits the winners into an older and a newer half. */
export function midpoint(reels: StatReel[]): string | null {
  const dates = reels
    .filter((r) => r.cohort === "winner" && r.postedAt)
    .map((r) => r.postedAt!)
    .sort();
  if (dates.length < 4) return null;
  return dates[Math.floor(dates.length / 2)];
}
