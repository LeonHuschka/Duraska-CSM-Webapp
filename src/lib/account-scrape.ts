import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Read each posting account off its platform once a day.
 *
 * This replaces reading numbers off the screenshots the VAs post. That
 * pipeline matched grid tiles to our cuts by picture and by position, and
 * neither was an identity: a tile that could not be matched was keyed on
 * where it sat in the picture — a different place every morning — so one
 * reel became five rows, some reels were never found at all, and the view
 * counts were whatever the vision model made of a JPEG.
 *
 * A scrape names every post by the platform's own id, gives the counts as
 * numbers, and sees the whole profile whether or not anybody marked a
 * posting in the app. Measured 2026-09-06 on public profiles:
 *
 *   instagram  apify/instagram-profile-scraper   $0.0026 a profile, and the
 *              profile row carries the 12 latest posts with views, likes and
 *              comments — one call per account per day is the whole job
 *   facebook   apify/facebook-pages-scraper      $0.012 a page (followers)
 *              apify/facebook-posts-scraper      $0.005 a post (likes,
 *              comments, shares, views on videos)
 *
 * Five Instagram accounts and two Facebook pages come to about $4 a month.
 * Every account is one call, so the bill grows with accounts, not posts.
 */

const IG_ACTOR = "apify~instagram-profile-scraper";

/**
 * The profile scraper's videoViewCount is not the number on the profile.
 * Instagram's grid shows plays — every play, replays included — and only a
 * per-post read returns that field: Reel #25 read 25,622 from the profile
 * and 51,333 from the post, which is what the app showed. So reels inside
 * the tracking window get a second, per-post read at $0.0027 each. Older
 * posts keep the last plays figure they had rather than dropping to the
 * smaller metric, which would read as a loss of views overnight.
 */
const IG_POSTS_ACTOR = "apify~instagram-scraper";
const PLAYS_WINDOW_MS = 5 * 86_400_000;
const FB_PAGES_ACTOR = "apify~facebook-pages-scraper";
const FB_POSTS_ACTOR = "apify~facebook-posts-scraper";

/** Two posts a day, tracked for five: ten covers the window with room. */
const FB_POSTS_PER_PAGE = 10;

/** One actor run may take this long; three run side by side. */
const RUN_TIMEOUT_MS = 150_000;

/**
 * A cost brake, not a plan. Twenty-five Instagram accounts would be seven
 * cents a day; the point is that a runaway list of accounts cannot become
 * a runaway bill.
 */
const MAX_ACCOUNTS = 25;

/**
 * A scraped post is matched to the cut a VA marked posted on that account
 * closest in time, if the two are within this of each other. Marking
 * happens the same day as posting, usually within the hour.
 */
const MATCH_WINDOW_MS = 36 * 3600_000;

type Row = Record<string, unknown>;
type Sb = SupabaseClient<Database>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
};

async function runActor(
  actor: string,
  input: unknown
): Promise<{ rows: Row[]; error: string | null }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { rows: [], error: "APIFY_TOKEN is not set" };
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      }
    );
    if (!res.ok) return { rows: [], error: `${actor}: http ${res.status}` };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { rows: [], error: `${actor}: no rows` };
    return { rows: body as Row[], error: null };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      rows: [],
      error: timedOut
        ? `${actor}: no answer in ${RUN_TIMEOUT_MS / 1000}s`
        : `${actor}: ${err instanceof Error ? err.message : "failed"}`,
    };
  }
}

/** "@Name", "name", or a pasted profile URL — all mean the same account. */
function igUsername(handle: string): string {
  const m = handle.match(/instagram\.com\/([^/?#]+)/i);
  return (m ? m[1] : handle).trim().replace(/^@/, "").toLowerCase();
}
function fbPageUrl(handle: string): string {
  const h = handle.trim();
  if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, "");
  return `https://www.facebook.com/${h.replace(/^@/, "")}`;
}
/** Enough of a URL to tell two pages apart, and no more. */
function fbKey(url: string | null): string {
  return (url ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.|m\.|web\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

type Account = { id: string; handle: string; platform: string };

/** What one post looked like today. */
type PostReading = {
  shortcode: string;
  url: string | null;
  postedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  caption: string | null;
  /** True when `views` is the plays figure the profile shows. */
  viewsArePlays?: boolean;
};

type AccountReading = {
  account: Account;
  followers: number | null;
  follows: number | null;
  postsCount: number | null;
  posts: PostReading[];
  note: string | null;
};

async function readInstagram(accounts: Account[]): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byName = new Map(accounts.map((a) => [igUsername(a.handle), a]));
  const { rows, error } = await runActor(IG_ACTOR, {
    usernames: Array.from(byName.keys()),
  });
  if (error) console.error("[scrape] instagram:", error);

  const out = new Map<string, AccountReading>();
  for (const r of rows) {
    const name = str(r.username)?.toLowerCase();
    const account = name ? byName.get(name) : undefined;
    if (!account) continue;
    const posts = (Array.isArray(r.latestPosts) ? (r.latestPosts as Row[]) : [])
      .map((p): PostReading | null => {
        const shortcode = str(p.shortCode);
        if (!shortcode) return null;
        return {
          shortcode,
          url: str(p.url) ?? `https://www.instagram.com/p/${shortcode}/`,
          postedAt: str(p.timestamp),
          views: num(p.videoViewCount) ?? num(p.videoPlayCount),
          likes: num(p.likesCount),
          comments: num(p.commentsCount),
          shares: null,
          caption: str(p.caption),
        };
      })
      .filter((p): p is PostReading => p !== null);
    out.set(account.id, {
      account,
      followers: num(r.followersCount),
      follows: num(r.followsCount),
      postsCount: num(r.postsCount),
      posts,
      note: r.private === true ? "private — posts not visible" : null,
    });
  }
  for (const a of accounts) {
    if (!out.has(a.id)) {
      out.set(a.id, {
        account: a,
        followers: null,
        follows: null,
        postsCount: null,
        posts: [],
        note: error ?? "not in the scraper's answer",
      });
    }
  }

  // Plays for everything inside the tracking window, in one run.
  const cutoff = Date.now() - PLAYS_WINDOW_MS;
  const fresh: PostReading[] = [];
  out.forEach((r) => {
    for (const p of r.posts) {
      if (p.postedAt && new Date(p.postedAt).getTime() >= cutoff && p.url) fresh.push(p);
    }
  });
  const plays = new Map<string, Row>();
  if (fresh.length > 0) {
    const res = await runActor(IG_POSTS_ACTOR, {
      directUrls: fresh.map((p) => p.url),
      resultsType: "posts",
      resultsLimit: fresh.length,
    });
    if (res.error) console.error("[scrape] instagram plays:", res.error);
    for (const row of res.rows) {
      const code = str(row.shortCode);
      if (code) plays.set(code, row);
    }
  }
  out.forEach((r) => {
    for (const p of r.posts) {
      const row = plays.get(p.shortcode);
      if (row) {
        p.views = num(row.videoPlayCount) ?? num(row.videoViewCount) ?? p.views;
        p.likes = num(row.likesCount) ?? p.likes;
        p.comments = num(row.commentsCount) ?? p.comments;
        p.viewsArePlays = true;
      } else {
        // Outside the window, or unanswered: not this metric. The writer
        // carries the last plays figure forward instead.
        p.views = null;
      }
    }
  });
  return Array.from(out.values());
}

async function readFacebook(accounts: Account[]): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byKey = new Map(accounts.map((a) => [fbKey(fbPageUrl(a.handle)), a]));
  const startUrls = accounts.map((a) => ({ url: fbPageUrl(a.handle) }));

  const [pages, posts] = await Promise.all([
    runActor(FB_PAGES_ACTOR, { startUrls }),
    runActor(FB_POSTS_ACTOR, { startUrls, resultsLimit: FB_POSTS_PER_PAGE }),
  ]);
  if (pages.error) console.error("[scrape] facebook pages:", pages.error);
  if (posts.error) console.error("[scrape] facebook posts:", posts.error);

  const find = (r: Row): Account | undefined => {
    for (const k of ["inputUrl", "pageUrl", "facebookUrl", "url"]) {
      const a = byKey.get(fbKey(str(r[k])));
      if (a) return a;
    }
    // Posts carry the page in their own URL: facebook.com/<page>/posts/…
    const u = fbKey(str(r.url) ?? str(r.topLevelUrl));
    for (const [k, a] of Array.from(byKey.entries())) {
      if (u.startsWith(k + "/")) return a;
    }
    return undefined;
  };

  const out = new Map<string, AccountReading>();
  for (const a of accounts) {
    out.set(a.id, {
      account: a,
      followers: null,
      follows: null,
      postsCount: null,
      posts: [],
      note: pages.error && posts.error ? pages.error : null,
    });
  }
  for (const r of pages.rows) {
    const a = find(r);
    if (!a) continue;
    const reading = out.get(a.id)!;
    reading.followers = num(r.followers) ?? num(r.likes);
  }
  for (const r of posts.rows) {
    const a = find(r);
    if (!a) continue;
    const shortcode = str(r.postId);
    if (!shortcode) continue;
    out.get(a.id)!.posts.push({
      shortcode,
      url: str(r.url) ?? str(r.topLevelUrl),
      postedAt: str(r.time),
      views: num(r.viewsCount),
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      caption: str(r.text),
    });
  }
  // A page the scrapers never answered for is almost always a handle that
  // is not a page: "Lyza tbd" is a placeholder, not facebook.com/Lyza%20tbd.
  out.forEach((reading) => {
    if (reading.followers == null && reading.posts.length === 0 && !reading.note) {
      reading.note = `nothing found at ${fbPageUrl(reading.account.handle)} — is the handle the page's name?`;
    }
  });
  return Array.from(out.values());
}

/**
 * Which of our cuts is this post? The VA marked one posted on this account
 * around the time the platform says the post went up; the nearest such
 * mark within the window is taken, once. A post already matched on an
 * earlier day keeps its match — the platform's id is stable, so there is
 * no reason to decide twice.
 */
async function matchToCuts(
  supabase: Sb,
  personaId: string,
  readings: AccountReading[]
): Promise<Map<string, { requestId: string | null; assetId: string | null; method: string }>> {
  const result = new Map<string, { requestId: string | null; assetId: string | null; method: string }>();
  const key = (accountId: string, shortcode: string) => `${accountId}|${shortcode}`;

  const shortcodes = readings.flatMap((r) => r.posts.map((p) => p.shortcode));
  if (shortcodes.length === 0) return result;

  const { data: known } = await supabase
    .from("reel_metrics")
    .select("account_id, shortcode, request_id, asset_id, match_method, captured_at")
    .eq("persona_id", personaId)
    .eq("source", "scrape")
    .in("shortcode", shortcodes)
    .not("request_id", "is", null)
    .order("captured_at", { ascending: false });
  for (const k of known ?? []) {
    if (!k.account_id || !k.shortcode) continue;
    const id = key(k.account_id, k.shortcode);
    if (!result.has(id)) {
      result.set(id, { requestId: k.request_id, assetId: k.asset_id, method: k.match_method ?? "kept" });
    }
  }

  const { data: slots } = await supabase
    .from("schedule_slots")
    .select("account_id, request_id, asset_id, posted_at, scheduled_for")
    .eq("persona_id", personaId)
    .eq("status", "posted")
    .not("account_id", "is", null);
  const marks = (slots ?? [])
    .map((s) => ({
      accountId: s.account_id as string,
      requestId: s.request_id,
      assetId: s.asset_id,
      at: new Date(s.posted_at ?? s.scheduled_for).getTime(),
    }))
    .filter((m) => Number.isFinite(m.at));
  // A cut already attributed to a post is not available to another one.
  const taken = new Set<string>();
  result.forEach((v) => {
    if (v.assetId) taken.add(`asset:${v.assetId}`);
  });

  for (const r of readings) {
    const mine = marks.filter((m) => m.accountId === r.account.id);
    const posts = r.posts
      .filter((p) => p.postedAt && !result.has(key(r.account.id, p.shortcode)))
      .sort((a, b) => (a.postedAt! < b.postedAt! ? -1 : 1));
    for (const p of posts) {
      const at = new Date(p.postedAt!).getTime();
      let best: (typeof mine)[number] | null = null;
      let bestD = MATCH_WINDOW_MS;
      for (const m of mine) {
        if (m.assetId && taken.has(`asset:${m.assetId}`)) continue;
        const d = Math.abs(m.at - at);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      if (!best) continue;
      if (best.assetId) taken.add(`asset:${best.assetId}`);
      result.set(key(r.account.id, p.shortcode), {
        requestId: best.requestId,
        assetId: best.assetId,
        method: "posted-time",
      });
    }
  }
  return result;
}

export type ScrapeSummary = {
  accounts: number;
  posts: number;
  matched: number;
  estimatedUsd: number;
  notes: string[];
};

/** One persona's accounts, read and written. */
export async function scrapeAccounts(supabase: Sb, personaId: string): Promise<ScrapeSummary> {
  const { data: rows } = await supabase
    .from("accounts")
    .select("id, handle, platform, status")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")')
    .order("platform")
    .limit(MAX_ACCOUNTS);
  const accounts = (rows ?? []) as Account[];
  const ig = accounts.filter((a) => a.platform === "instagram");
  const fb = accounts.filter((a) => a.platform === "facebook");

  const [igReadings, fbReadings] = await Promise.all([readInstagram(ig), readFacebook(fb)]);
  const readings = [...igReadings, ...fbReadings];
  const matches = await matchToCuts(supabase, personaId, readings);

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const notes: string[] = [];
  let posts = 0;
  let matched = 0;
  let playsRead = 0;

  // The last views figure stored for each post, for the ones not re-read
  // today — so a reel leaving the tracking window keeps its number.
  const carry = new Map<string, number>();
  const unread = readings.flatMap((r) =>
    r.posts.filter((p) => p.views == null && !p.viewsArePlays).map((p) => p.shortcode)
  );
  if (unread.length > 0) {
    const { data: prev } = await supabase
      .from("reel_metrics")
      .select("account_id, shortcode, views, captured_at")
      .eq("persona_id", personaId)
      .eq("source", "scrape")
      .in("shortcode", unread)
      .not("views", "is", null)
      .order("captured_at", { ascending: false });
    for (const p of prev ?? []) {
      const k = `${p.account_id}|${p.shortcode}`;
      if (!carry.has(k) && p.views != null) carry.set(k, Number(p.views));
    }
  }

  for (const r of readings) {
    if (r.note) notes.push(`@${r.account.handle}: ${r.note}`);
    const hasProfile = r.followers != null || r.follows != null || r.postsCount != null;

    // One reading per account per day. A second run the same day — a manual
    // trigger, a retry — replaces the morning's rather than sitting beside it.
    if (hasProfile) {
      await supabase
        .from("account_metrics")
        .delete()
        .eq("account_id", r.account.id)
        .eq("source", "scrape")
        .gte("captured_at", `${today}T00:00:00Z`);
      const { error } = await supabase.from("account_metrics").insert({
        persona_id: personaId,
        account_id: r.account.id,
        captured_at: now,
        handle: r.account.handle,
        platform: r.account.platform,
        metric_kind: "profile",
        followers: r.followers,
        follows: r.follows,
        posts_count: r.postsCount,
        source: "scrape",
        confidence: 1,
        needs_review: false,
      });
      if (error) notes.push(`@${r.account.handle}: profile not stored — ${error.message}`);
    }

    if (r.posts.length === 0) continue;
    await supabase
      .from("reel_metrics")
      .delete()
      .eq("account_id", r.account.id)
      .eq("source", "scrape")
      .gte("captured_at", `${today}T00:00:00Z`);
    const { error } = await supabase.from("reel_metrics").insert(
      r.posts.map((p, i) => {
        const m = matches.get(`${r.account.id}|${p.shortcode}`);
        if (m?.requestId) matched++;
        if (p.viewsArePlays) playsRead++;
        const views = p.views ?? carry.get(`${r.account.id}|${p.shortcode}`) ?? null;
        return {
          persona_id: personaId,
          account_id: r.account.id,
          captured_at: now,
          position: i + 1,
          shortcode: p.shortcode,
          post_url: p.url,
          posted_at: p.postedAt,
          views,
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
          caption: p.caption,
          request_id: m?.requestId ?? null,
          asset_id: m?.assetId ?? null,
          match_method: m?.method ?? null,
          match_confirmed: false,
          source: "scrape",
          confidence: 1,
          needs_review: false,
        };
      })
    );
    if (error) notes.push(`@${r.account.handle}: posts not stored — ${error.message}`);
    else {
      posts += r.posts.length;
      // The screenshot readings this replaces. They keyed unmatched tiles
      // on their position in the picture, so one reel was five rows; once
      // the platform has been read they are noise, and they go.
      await supabase
        .from("reel_metrics")
        .delete()
        .eq("account_id", r.account.id)
        .eq("source", "screenshot");
    }
  }

  const estimatedUsd =
    ig.length * 0.0026 +
    playsRead * 0.0027 +
    fb.length * (0.012 + FB_POSTS_PER_PAGE * 0.005) +
    (fb.length ? 0.001 : 0);
  console.log(
    `[scrape] persona ${personaId}: ${accounts.length} accounts, ${posts} posts, ${matched} matched, ~$${estimatedUsd.toFixed(3)}` +
      (notes.length ? ` — ${notes.join("; ")}` : "")
  );
  return { accounts: accounts.length, posts, matched, estimatedUsd, notes };
}
