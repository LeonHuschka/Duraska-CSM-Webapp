import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CODEBOOK_VERSION } from "@/lib/analysis/codebook";

type Db = SupabaseClient<Database>;
const DAY = 86_400_000;

/**
 * Which reels Analysis looks at, and as what.
 *
 * - winner: the same rule the WINNERS topic uses — plays at least
 *   viral_lift × the account's median and at least viral_min_views.
 * - loser: at most LOSER_LIFT × median, and a clean one: not a Trial-Maxxing
 *   reshoot, and not from a stretch where the whole account was down (then
 *   it flopped for the account, not for what is in it).
 * - control: a few ordinary reels per account and month, the middle that
 *   keeps winner-against-loser honest. Picked by a hash of the shortcode, so
 *   the same reels stay picked from run to run.
 *
 * Only reels at least MATURE_DAYS old count: a two-day-old reel has not had
 * its reach yet and would read as a loser.
 */
const MATURE_DAYS = 7;
const LOSER_LIFT = 0.5;
const CONTROL_BAND = [0.7, 2] as const;
const CONTROL_PER_MONTH = 4;
/** Other reels of the account within this many days tell whether it was a bad stretch. */
const STRETCH_DAYS = 3;
const MIN_REELS = 6;

export type CohortReel = {
  accountId: string;
  personaId: string;
  shortcode: string;
  postUrl: string | null;
  postedAt: string;
  requestId: string | null;
  cohort: "winner" | "loser" | "control";
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  lift: number;
};

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export async function selectCohorts(supabase: Db, personaId: string): Promise<CohortReel[]> {
  const [{ data: cfg }, { data: accounts }, { data: cells }] = await Promise.all([
    supabase.from("telegram_config").select("viral_lift, viral_min_views").eq("persona_id", personaId).maybeSingle(),
    supabase
      .from("accounts")
      .select("id, posts_per_day, status")
      .eq("persona_id", personaId)
      .not("status", "in", '("dead","paused")')
      .gt("posts_per_day", 0),
    supabase.from("trial_cells").select("request_id").not("request_id", "is", null),
  ]);
  const lift = Number(cfg?.viral_lift ?? 5);
  const minViews = Number(cfg?.viral_min_views ?? 10_000);
  const trialRequests = new Set((cells ?? []).map((c) => c.request_id));
  const ids = (accounts ?? []).map((a) => a.id);
  if (!ids.length) return [];

  // Latest reading per reel; the table holds one row per reel per morning.
  const rows: NonNullable<Awaited<ReturnType<typeof page>>["data"]> = [];
  async function page(from: number) {
    return supabase
      .from("reel_metrics")
      .select("account_id, shortcode, post_url, posted_at, captured_at, views, likes, comments, shares, request_id")
      .eq("persona_id", personaId)
      .eq("source", "scrape")
      .eq("needs_review", false)
      .in("account_id", ids)
      .not("shortcode", "is", null)
      .not("views", "is", null)
      .not("posted_at", "is", null)
      .order("captured_at", { ascending: false })
      .range(from, from + 999);
  }
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await page(from);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.account_id}|${r.shortcode}`;
    if (!latest.has(key)) latest.set(key, r);
  }

  const matureBefore = Date.now() - MATURE_DAYS * DAY;
  const byAccount = new Map<string, (typeof rows)[number][]>();
  latest.forEach((r) => {
    if (new Date(r.posted_at!).getTime() > matureBefore) return;
    const list = byAccount.get(r.account_id!) ?? [];
    list.push(r);
    byAccount.set(r.account_id!, list);
  });

  const out: CohortReel[] = [];
  byAccount.forEach((list, accountId) => {
    if (list.length < MIN_REELS) return;
    const mid = median(list.map((r) => Number(r.views)).filter((v) => v > 0));
    if (mid <= 0) return;
    const withLift = list.map((r) => ({ r, lift: Number(r.views) / mid, t: new Date(r.posted_at!).getTime() }));
    const controls = new Map<string, typeof withLift>();

    for (const x of withLift) {
      const base = {
        accountId,
        personaId,
        shortcode: x.r.shortcode!,
        postUrl: x.r.post_url,
        postedAt: x.r.posted_at!,
        requestId: x.r.request_id,
        views: Number(x.r.views),
        likes: x.r.likes,
        comments: x.r.comments,
        shares: x.r.shares,
        lift: x.lift,
      };
      if (x.lift >= lift && base.views >= minViews) {
        out.push({ ...base, cohort: "winner" });
      } else if (x.lift <= LOSER_LIFT) {
        if (x.r.request_id && trialRequests.has(x.r.request_id)) continue;
        const near = withLift.filter((o) => o !== x && Math.abs(o.t - x.t) <= STRETCH_DAYS * DAY).map((o) => o.lift);
        if (near.length >= 2 && median(near) < LOSER_LIFT) continue; // the account was down, not this reel
        out.push({ ...base, cohort: "loser" });
      } else if (x.lift >= CONTROL_BAND[0] && x.lift <= CONTROL_BAND[1]) {
        const month = x.r.posted_at!.slice(0, 7);
        const list = controls.get(month) ?? [];
        list.push(x);
        controls.set(month, list);
      }
    }
    controls.forEach((list) => {
      list
        .sort((a, b) => hash(a.r.shortcode!) - hash(b.r.shortcode!))
        .slice(0, CONTROL_PER_MONTH)
        .forEach((x) =>
          out.push({
            accountId,
            personaId,
            shortcode: x.r.shortcode!,
            postUrl: x.r.post_url,
            postedAt: x.r.posted_at!,
            requestId: x.r.request_id,
            views: Number(x.r.views),
            likes: x.r.likes,
            comments: x.r.comments,
            shares: x.r.shares,
            lift: x.lift,
            cohort: "control",
          })
        );
    });
  });
  return out;
}

/**
 * Bring reel_analyses in line with today's cohorts: new reels become
 * pending, known ones get today's numbers and cohort. A reel already
 * watched is not watched again unless the codebook changed since.
 */
export async function syncCohorts(supabase: Db, personaId: string, reels: CohortReel[]) {
  const { data: known } = await supabase
    .from("reel_analyses")
    .select("id, account_id, shortcode, status, codebook_version")
    .eq("persona_id", personaId);
  const byKey = new Map((known ?? []).map((k) => [`${k.account_id}|${k.shortcode}`, k]));
  let added = 0, again = 0;
  for (const r of reels) {
    const row = {
      persona_id: personaId,
      account_id: r.accountId,
      shortcode: r.shortcode,
      post_url: r.postUrl,
      posted_at: r.postedAt,
      request_id: r.requestId,
      cohort: r.cohort,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      lift: r.lift,
    };
    const k = byKey.get(`${r.accountId}|${r.shortcode}`);
    if (!k) {
      await supabase.from("reel_analyses").insert({ ...row, status: "pending" });
      added++;
      continue;
    }
    const stale = k.status === "done" && (k.codebook_version ?? 0) < CODEBOOK_VERSION;
    // A reel that turned winner needs its comments read, which only winners get.
    await supabase
      .from("reel_analyses")
      .update(stale || k.status === "working" ? { ...row, status: "pending", attempts: 0 } : row)
      .eq("id", k.id);
    if (stale) again++;
  }
  return { added, again };
}
