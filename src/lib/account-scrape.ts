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

/**
 * Followers only. $0.0026 a profile. It also carries the twelve latest
 * posts, but their videoViewCount is not the number on the profile — that
 * is plays, replays included, and this actor does not return it.
 */
const IG_PROFILE_ACTOR = "apify~instagram-profile-scraper";

/**
 * The posts, with plays. $0.0003 a post and $0.005 a run, one run for every
 * account at once. Measured on the real account: play_count 51,441 for the
 * reel the profile shows at 51k, in six seconds; the per-post read from
 * Apify's own scraper gave 51,333 for $0.0027 — nine times the price for
 * the same answer.
 */
const IG_POSTS_ACTOR = "sones~instagram-posts-scraper-lowcost";
const IG_POSTS_PER_ACCOUNT = 12;

/** Followers only. $0.012 a page — the dearest line left, and it is 1¢. */
const FB_PAGES_ACTOR = "apify~facebook-pages-scraper";

/**
 * The reels, with views, reactions, comments and shares. $0.0003 a reel and
 * $0.0005 a run. Measured on Harold's page against Apify's posts scraper at
 * $0.005 a post: the same numbers, a sixteenth of the price. Reels only —
 * which is all these pages post.
 */
const FB_REELS_ACTOR = "dami_studio~facebook-reels-scraper";
const FB_REELS_PER_PAGE = 10;

/**
 * The fallback, for pages the cheap actor cannot read. A page made from a
 * profile — facebook.com/people/Name/ID — has no public Reels tab, and the
 * cheap actor answers NO_REELS for it while the reels sit in its feed. This
 * one reads the feed, at $0.005 a post — sixteen times the price, so it is
 * asked only about the pages that came back empty.
 */
const FB_POSTS_ACTOR = "apify~facebook-posts-scraper";

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
  /** The post's own cover image, so an unmatched post is still a picture. */
  thumbnailUrl: string | null;
};

type AccountReading = {
  account: Account;
  followers: number | null;
  follows: number | null;
  postsCount: number | null;
  posts: PostReading[];
  note: string | null;
  /** Read through the dear feed scraper rather than the cheap reels one. */
  viaFeed?: boolean;
};

async function readInstagram(accounts: Account[]): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byName = new Map(accounts.map((a) => [igUsername(a.handle), a]));
  const usernames = Array.from(byName.keys());

  const [profiles, posts] = await Promise.all([
    runActor(IG_PROFILE_ACTOR, { usernames }),
    runActor(IG_POSTS_ACTOR, { usernames, postsPerProfile: IG_POSTS_PER_ACCOUNT }),
  ]);
  if (profiles.error) console.error("[scrape] instagram profiles:", profiles.error);
  if (posts.error) console.error("[scrape] instagram posts:", posts.error);

  const out = new Map<string, AccountReading>();
  for (const a of accounts) {
    out.set(a.id, {
      account: a,
      followers: null,
      follows: null,
      postsCount: null,
      posts: [],
      note: profiles.error && posts.error ? profiles.error : null,
    });
  }
  for (const r of profiles.rows) {
    const a = byName.get(str(r.username)?.toLowerCase() ?? "");
    if (!a) continue;
    const reading = out.get(a.id)!;
    reading.followers = num(r.followersCount);
    reading.follows = num(r.followsCount);
    reading.postsCount = num(r.postsCount);
    if (r.private === true) reading.note = "private — posts not visible";
  }
  for (const r of posts.rows) {
    const a = byName.get(str(r.scraped_username)?.toLowerCase() ?? "");
    const shortcode = str(r.code);
    if (!a || !shortcode) continue;
    const takenAt = num(r.taken_at);
    out.get(a.id)!.posts.push({
      shortcode,
      url: str(r.post_url) ?? `https://www.instagram.com/p/${shortcode}/`,
      postedAt: takenAt ? new Date(takenAt * 1000).toISOString() : null,
      // Plays — the figure on the profile. Null on images, which have none.
      views: num(r.play_count),
      likes: num(r.like_count),
      comments: num(r.comment_count),
      shares: null,
      // sones wraps the caption: { pk, text }.
      caption: str(
        r.caption && typeof r.caption === "object" ? (r.caption as Row).text : r.caption
      ),
      thumbnailUrl: str(r.image_url),
    });
  }
  out.forEach((reading) => {
    if (reading.followers == null && reading.posts.length === 0 && !reading.note) {
      reading.note = "not in the scrapers' answer — is the handle right?";
    }
  });
  return Array.from(out.values());
}

async function readFacebook(accounts: Account[]): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byKey = new Map(accounts.map((a) => [fbKey(fbPageUrl(a.handle)), a]));
  const urls = accounts.map((a) => fbPageUrl(a.handle));

  const [pages, reels] = await Promise.all([
    runActor(FB_PAGES_ACTOR, { startUrls: urls.map((url) => ({ url })) }),
    runActor(FB_REELS_ACTOR, { startUrls: urls, resultsLimit: FB_REELS_PER_PAGE }),
  ]);
  if (pages.error) console.error("[scrape] facebook pages:", pages.error);
  if (reels.error) console.error("[scrape] facebook reels:", reels.error);

  const find = (r: Row): Account | undefined => {
    for (const k of ["inputUrl", "pageUrl", "facebookUrl", "url"]) {
      const a = byKey.get(fbKey(str(r[k])));
      if (a) return a;
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
      note: pages.error && reels.error ? pages.error : null,
    });
  }
  for (const r of pages.rows) {
    const a = find(r);
    if (!a) continue;
    out.get(a.id)!.followers = num(r.followers) ?? num(r.likes);
  }
  for (const r of reels.rows) {
    const a = find(r);
    const shortcode = str(r.reelId) ?? str(r.postId);
    if (!a || !shortcode || r.ok === false) continue;
    out.get(a.id)!.posts.push({
      shortcode,
      url: str(r.reelUrl),
      postedAt: str(r.time),
      views: num(r.viewCount),
      likes: num(r.reactionsCount),
      comments: num(r.commentsCount),
      shares: num(r.sharesCount),
      caption: str(r.caption),
      thumbnailUrl: str(r.thumbnailUrl) ?? str(r.previewImageUrl),
    });
  }
  // Pages the cheap actor could not read get the dear one, feed and all.
  const empty = accounts.filter((a) => out.get(a.id)!.posts.length === 0);
  if (empty.length > 0) {
    const feed = await runActor(FB_POSTS_ACTOR, {
      startUrls: empty.map((a) => ({ url: fbPageUrl(a.handle) })),
      resultsLimit: FB_REELS_PER_PAGE,
    });
    if (feed.error) console.error("[scrape] facebook feed:", feed.error);
    for (const r of feed.rows) {
      const a = find(r);
      const shortcode = str(r.postId);
      if (!a || !shortcode) continue;
      const media = Array.isArray(r.media) ? (r.media as Row[]) : [];
      out.get(a.id)!.posts.push({
        shortcode,
        url: str(r.url) ?? str(r.topLevelUrl),
        postedAt: str(r.time),
        views: num(r.viewsCount),
        likes: num(r.likes),
        comments: num(r.comments),
        shares: num(r.shares),
        caption: str(r.text),
        thumbnailUrl: str(media[0]?.thumbnail) ?? str(media[0]?.photo_image?.["uri" as keyof object]),
      });
    }
    for (const a of empty) {
      const reading = out.get(a.id)!;
      if (reading.posts.length > 0) reading.viaFeed = true;
    }
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

    // The screenshot readings this replaces. They keyed unmatched tiles on
    // their position in the picture, so one reel was five rows; once the
    // platform has answered for the account at all — followers count — they
    // are noise and they go, whether or not any post came back today.
    if (hasProfile || r.posts.length > 0) {
      await supabase
        .from("reel_metrics")
        .delete()
        .eq("account_id", r.account.id)
        .eq("source", "screenshot");
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
        return {
          persona_id: personaId,
          account_id: r.account.id,
          captured_at: now,
          position: i + 1,
          shortcode: p.shortcode,
          post_url: p.url,
          posted_at: p.postedAt,
          views: p.views,
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
          caption: p.caption,
          // tile_path once held the crop of a screenshot tile; with the
          // screenshot pipeline gone it carries the post's cover URL from
          // the platform's CDN, which is what the accounts tab shows when
          // the post is not one of ours.
          tile_path: p.thumbnailUrl,
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
    else posts += r.posts.length;
  }

  const viaFeed = readings.filter((r) => r.viaFeed).length;
  const estimatedUsd =
    ig.length * 0.0026 +
    (ig.length ? 0.005 + ig.length * IG_POSTS_PER_ACCOUNT * 0.0003 : 0) +
    fb.length * 0.012 +
    (fb.length ? 0.0005 + (fb.length - viaFeed) * FB_REELS_PER_PAGE * 0.0003 : 0) +
    (viaFeed ? 0.001 + viaFeed * FB_REELS_PER_PAGE * 0.005 : 0);
  console.log(
    `[scrape] persona ${personaId}: ${accounts.length} accounts, ${posts} posts, ${matched} matched, ~$${estimatedUsd.toFixed(3)}` +
      (notes.length ? ` — ${notes.join("; ")}` : "")
  );
  return { accounts: accounts.length, posts, matched, estimatedUsd, notes };
}
