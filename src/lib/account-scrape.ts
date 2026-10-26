import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { storeCovers, storeImage } from "@/lib/stored-images";

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

/**
 * The reels with plays, since 2026-10-15. That morning the cheap actor
 * above stopped carrying a play count — every reel came back with likes
 * and comments and a null where the plays had been, and every Instagram
 * line on the dashboard went flat. This one reads a profile's Reels tab
 * and still has them: $0.0015 a reel, one run per account. The cheap actor
 * stays as the fallback for an account this one cannot read, so likes and
 * covers keep coming even on a bad day.
 */
const IG_REELS_ACTOR = "data-slayer~instagram-profile-reels";

/** The same maker's by-URL actor, for the reels the Reels tab leaves out. */
const IG_POST_ACTOR = "data-slayer~instagram-post-details";
/** A brake: at $0.0015 a reel, sixty is nine cents. */
const HIDDEN_REELS_MAX = 60;
/**
 * The daily window. Eight reels is four days at two a day — the days a
 * reel moves most; one that has left it keeps its last reading. Twelve
 * cost a third more and moved the month past the $5 the plan includes.
 */
const IG_POSTS_PER_ACCOUNT = 8;

/**
 * A full read takes every reel the account has, not just the newest. Done
 * once when an account is added, so the list and the totals are the
 * account's whole life; the daily read then only needs the newest few,
 * and a reel that has left that window keeps the last reading it got.
 */
const FULL_POSTS_PER_ACCOUNT = 100;

/** Followers only. $0.012 a page — the dearest line left, and it is 1¢. */
const FB_PAGES_ACTOR = "apify~facebook-pages-scraper";

/**
 * The reels, with views, reactions, comments and shares. $0.0003 a reel and
 * $0.0005 a run. Measured on Harold's page against Apify's posts scraper at
 * $0.005 a post: the same numbers, a sixteenth of the price. Reels only —
 * which is all these pages post.
 */
const FB_REELS_ACTOR = "dami_studio~facebook-reels-scraper";
/** Six: the feed fallback charges $0.005 for every post, reel or not. */
const FB_REELS_PER_PAGE = 6;

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

/** A picture URL the browser can actually fetch; lookaside needs a login. */
const usable = (u: string | null) => {
  if (!u) return null;
  try {
    return /(^|\.)lookaside\.fbsbx\.com$/i.test(new URL(u).hostname) ? null : u;
  } catch {
    return null;
  }
};
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
};

async function runActor(
  actor: string,
  input: unknown,
  opts: { memoryMb?: number; retry?: boolean } = {}
): Promise<{ rows: Row[]; error: string | null }> {
  const first = await runActorOnce(actor, input, opts.memoryMb);
  // The plan has a memory ceiling shared by every run at once; a start it
  // cannot fit is refused rather than queued. Once more, a little later.
  if (opts.retry && first.error && /http (402|429|503)/.test(first.error)) {
    await new Promise((r) => setTimeout(r, 8_000));
    return runActorOnce(actor, input, opts.memoryMb);
  }
  return first;
}

async function runActorOnce(
  actor: string,
  input: unknown,
  memoryMb?: number
): Promise<{ rows: Row[]; error: string | null }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { rows: [], error: "APIFY_TOKEN is not set" };
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}${
        memoryMb ? `&memory=${memoryMb}` : ""
      }`,
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
  // A page without a name is facebook.com/profile.php?id=… — there the id
  // in the query is the whole address, and dropping it would make every
  // such page the same page.
  const id = (url ?? "").match(/profile\.php\?(?:.*&)?id=(\d+)/i)?.[1];
  if (id) return `facebook.com/profile.php?id=${id}`;
  return (url ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.|m\.|web\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

type Account = { id: string; handle: string; platform: string; avatar_updated_at?: string | null };

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
  /** The profile picture on the platform's CDN, as the scrape found it. */
  avatarUrl?: string | null;
  /** Reels the profile lists as its newest — some the Reels tab leaves out. */
  extraCodes?: string[];
  /** Read through the dear feed scraper rather than the cheap reels one. */
  viaFeed?: boolean;
};

/** The number a field holds, at whichever of these paths it sits. */
function pick(r: Row, ...paths: string[]): unknown {
  for (const p of paths) {
    let v: unknown = r;
    for (const k of p.split(".")) {
      if (v && typeof v === "object") v = (v as Row)[k];
      else {
        v = undefined;
        break;
      }
    }
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/** One reel from the Reels-tab actor, in whatever shape it arrives. */
function reelFromProfileRow(r: Row): PostReading | null {
  const shortcode = str(pick(r, "code", "shortcode", "short_code", "media.code"));
  if (!shortcode) return null;
  const taken = pick(r, "taken_at", "media.taken_at", "posted_at", "timestamp");
  const postedAt =
    typeof taken === "number"
      ? new Date(taken * (taken < 1e12 ? 1000 : 1)).toISOString()
      : typeof taken === "string" && !Number.isNaN(Date.parse(taken))
        ? new Date(taken).toISOString()
        : null;
  return {
    shortcode,
    url: str(pick(r, "post_url", "url")) ?? `https://www.instagram.com/reel/${shortcode}/`,
    postedAt,
    // Plays, the figure on the profile grid. play_count first: it is the
    // field the dashboard's history was built on.
    views: num(
      pick(r, "play_count", "metrics.play_count", "media.play_count", "ig_play_count", "metrics.ig_play_count", "video_play_count", "view_count")
    ),
    likes: num(pick(r, "like_count", "metrics.like_count", "media.like_count", "likes")),
    comments: num(pick(r, "comment_count", "metrics.comment_count", "media.comment_count", "comments")),
    shares: num(pick(r, "share_count", "metrics.share_count", "reshare_count", "media.share_count")),
    caption: str(pick(r, "caption.text", "caption_text", "caption", "media.caption.text")),
    thumbnailUrl: str(
      pick(r, "image_versions2.candidates.0.url", "media.image_versions2.candidates.0.url", "thumbnail_url", "display_url", "image_url")
    ),
  };
}

/** Each account's Reels tab, one run per account, side by side. */
async function readInstagramReels(
  accounts: Account[],
  perAccount: number
): Promise<Map<string, { posts: PostReading[]; error: string | null }>> {
  const out = new Map<string, { posts: PostReading[]; error: string | null }>();
  // Two at a time and small: five at once with the Facebook runs beside
  // them went over the plan's memory and two starts were refused.
  const queue = [...accounts];
  const lane = async () => {
    while (queue.length) {
      const a = queue.shift()!;
      const run = await runActor(
        IG_REELS_ACTOR,
        { username: igUsername(a.handle), maxResults: perAccount },
        { memoryMb: 512, retry: true }
      );
      const posts = run.rows
        .filter((r) => r.success !== false)
        .map(reelFromProfileRow)
        .filter((p): p is PostReading => !!p);
      out.set(a.id, { posts, error: run.error ?? (posts.length === 0 && run.rows.length > 0 ? "no reels in the answer" : null) });
    }
  };
  await Promise.all([lane(), lane()]);
  return out;
}

/** What the by-URL post actor says about a few posts — plays, or why not. */
export async function probeInstagramPosts(codes: string[]) {
  const run = await runActor(
    "data-slayer~instagram-post-details",
    { postUrls: codes.map((c) => `https://www.instagram.com/reel/${c}/`) },
    { memoryMb: 512 }
  );
  return {
    error: run.error,
    rows: run.rows.map((r) => ({
      code: str(pick(r, "code", "shortcode", "postCode")),
      success: r.success ?? null,
      error: r.error ?? null,
      plays: num(pick(r, "play_count", "ig_play_count", "view_count")),
      likes: num(pick(r, "like_count")),
    })),
  };
}

/** The first rows of one account's Reels-tab answer, for checking fields. */
export async function probeInstagramReels(username: string, max = 3) {
  const run = await runActor(IG_REELS_ACTOR, { username, maxResults: max });
  return {
    error: run.error,
    rows: run.rows.slice(0, max).map((r) => ({
      parsed: reelFromProfileRow(r),
      counts: Object.fromEntries(
        Object.entries(r).filter(([k, v]) => /count|plays|views/i.test(k) && (typeof v === "number" || v === null))
      ),
      keys: Object.keys(r).slice(0, 60),
    })),
  };
}

async function readInstagram(accounts: Account[], perAccount: number): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byName = new Map(accounts.map((a) => [igUsername(a.handle), a]));
  const usernames = Array.from(byName.keys());

  const [profiles, reelsTab] = await Promise.all([
    runActor(IG_PROFILE_ACTOR, { usernames }, { retry: true }),
    readInstagramReels(accounts, perAccount),
  ]);
  // The cheap feed actor only for accounts the Reels tab gave nothing for.
  const missing = accounts.filter((a) => (reelsTab.get(a.id)?.posts.length ?? 0) === 0);
  const posts = missing.length
    ? await runActor(IG_POSTS_ACTOR, {
        usernames: missing.map((a) => igUsername(a.handle)),
        postsPerProfile: perAccount,
      })
    : { rows: [] as Row[], error: null };
  for (const [id, r] of Array.from(reelsTab.entries())) {
    if (r.error) console.error(`[scrape] instagram reels ${id}:`, r.error);
  }
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
  // Accounts Instagram named but would not describe: the profile scraper
  // gets an id and a display name, no counts, no posts. That is what
  // Instagram serves a logged-out visitor for an account it has put
  // behind the login wall — the handle is right, there is nothing to fix.
  const hidden = new Set<string>();
  for (const r of profiles.rows) {
    const a = byName.get(str(r.username)?.toLowerCase() ?? "");
    if (!a) continue;
    const reading = out.get(a.id)!;
    reading.followers = num(r.followersCount);
    reading.follows = num(r.followsCount);
    reading.postsCount = num(r.postsCount);
    reading.avatarUrl = str(r.profilePicUrlHD) ?? str(r.profilePicUrl);
    reading.extraCodes = (Array.isArray(r.latestPosts) ? (r.latestPosts as Row[]) : [])
      .filter((p) => p.type === "Video" || p.productType === "clips")
      .map((p) => str(p.shortCode))
      .filter((c): c is string => !!c);
    if (r.private === true) reading.note = "private — posts not visible";
    else if (reading.followers == null && str(r.id)) hidden.add(a.id);
  }
  for (const r of posts.rows) {
    const a = byName.get(str(r.scraped_username)?.toLowerCase() ?? "");
    const shortcode = str(r.code);
    if (!a || !shortcode) continue;
    // Reels only. media_type 2 is video; 1 is an image and 8 a carousel,
    // neither of which has plays or belongs in a row of reels.
    if (num(r.media_type) !== 2) continue;
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
  reelsTab.forEach((r, id) => {
    const reading = out.get(id);
    if (reading && r.posts.length > 0) reading.posts = r.posts;
  });
  out.forEach((reading) => {
    if (reading.posts.length > 0 && reading.posts.every((p) => p.views == null) && !reading.note) {
      reading.note = "reels read, but without plays — the views on this account are not moving until this is fixed";
    }
    if (reading.followers == null && reading.posts.length === 0 && !reading.note) {
      reading.note = hidden.has(reading.account.id)
        ? "Instagram is showing this account to logged-in visitors only right now — the handle is right; readings resume when Instagram lifts it"
        : "not in the scrapers' answer — is the handle right?";
    }
  });
  return Array.from(out.values());
}

async function readFacebook(accounts: Account[], perPage: number): Promise<AccountReading[]> {
  if (accounts.length === 0) return [];
  const byKey = new Map(accounts.map((a) => [fbKey(fbPageUrl(a.handle)), a]));
  const urls = accounts.map((a) => fbPageUrl(a.handle));

  const [pages, reels] = await Promise.all([
    runActor(FB_PAGES_ACTOR, { startUrls: urls.map((url) => ({ url })) }, { retry: true }),
    runActor(FB_REELS_ACTOR, { startUrls: urls, resultsLimit: perPage }, { retry: true }),
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
    out.get(a.id)!.avatarUrl =
      usable(str(r.profilePictureUrl)) ?? usable(str(r.profilePhoto)) ?? usable(str(r.profilePicture));
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
      // The actor hands back two pictures. `thumbnailUrl` sits behind
      // lookaside.fbsbx.com, which answers a plain request with a login
      // page; `previewImageUrl` is on the ordinary CDN and just loads.
      thumbnailUrl: usable(str(r.previewImageUrl)) ?? usable(str(r.thumbnailUrl)),
    });
  }
  // Pages the cheap actor could not read get the dear one, feed and all.
  const empty = accounts.filter((a) => out.get(a.id)!.posts.length === 0);
  if (empty.length > 0) {
    const feed = await runActor(FB_POSTS_ACTOR, {
      startUrls: empty.map((a) => ({ url: fbPageUrl(a.handle) })),
      resultsLimit: perPage,
    });
    if (feed.error) console.error("[scrape] facebook feed:", feed.error);
    for (const r of feed.rows) {
      const a = find(r);
      const shortcode = str(r.postId);
      if (!a || !shortcode) continue;
      // The feed carries everything; the row is for reels.
      if (r.isVideo !== true) continue;
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

/**
 * Reels the Reels tab leaves out. Instagram keeps some reels from anyone
 * not logged in — on 2026-10-20 five of sarahelenaprice's sixteen, among
 * them the two biggest at 212k and 94k — and the Reels-tab actor never
 * lists them. Read one by one through the by-URL actor they come back
 * whole, plays included. Which reels to ask about: the newest the profile
 * lists, and the reels this account already had that were posted inside
 * the window the Reels tab covered today but are missing from its answer.
 * Older reels outside that window keep their last reading, like every
 * other reel that has left the daily window — asking about all of them
 * every day would cost more than the rest of the scrape together.
 */
async function fillHiddenReels(supabase: Sb, readings: AccountReading[]) {
  const ig = readings.filter((r) => r.account.platform === "instagram");
  if (ig.length === 0) return;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: known } = await supabase
    .from("reel_metrics")
    .select("account_id, shortcode, posted_at")
    .in("account_id", ig.map((r) => r.account.id))
    .eq("source", "scrape")
    .not("shortcode", "is", null)
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(5000);
  const wanted = new Map<string, AccountReading>();
  for (const r of ig) {
    const answered = r.posts.filter((p) => p.views != null);
    const have = new Set(answered.map((p) => p.shortcode));
    // The oldest reel the Reels tab answered for marks today's window.
    const from = answered.reduce<string | null>(
      (min, p) => (p.postedAt && (!min || p.postedAt < min) ? p.postedAt : min),
      null
    );
    const codes = new Set([
      ...(r.extraCodes ?? []),
      ...(known ?? [])
        .filter((k) => k.account_id === r.account.id && (!from || (k.posted_at && k.posted_at >= from)))
        .map((k) => k.shortcode!),
    ]);
    codes.forEach((c) => {
      if (!have.has(c)) wanted.set(c, r);
    });
  }
  if (wanted.size === 0) return;
  const codes = Array.from(wanted.keys()).slice(0, HIDDEN_REELS_MAX);
  const run = await runActor(
    IG_POST_ACTOR,
    { postUrls: codes.map((c) => `https://www.instagram.com/reel/${c}/`) },
    { memoryMb: 512, retry: true }
  );
  if (run.error) console.error("[scrape] instagram hidden reels:", run.error);
  for (const row of run.rows) {
    if (row.success === false) continue;
    const post = reelFromProfileRow(row);
    if (!post || post.views == null) continue;
    const reading = wanted.get(post.shortcode);
    if (!reading) continue;
    reading.posts = [...reading.posts.filter((p) => p.shortcode !== post.shortcode), post];
  }
}

/** One persona's accounts, read and written. `full` reads every reel, not just the newest. */
export async function scrapeAccounts(
  supabase: Sb,
  personaId: string,
  opts: {
    full?: boolean;
    deadline?: number;
    igPerAccount?: number;
    fbPerPage?: number;
    accountIds?: string[];
    /** Reel codes to read by URL as well, per account — a one-off backfill. */
    extraCodes?: Record<string, string[]>;
  } = {}
): Promise<ScrapeSummary> {
  const perAccount = opts.igPerAccount ?? (opts.full ? FULL_POSTS_PER_ACCOUNT : IG_POSTS_PER_ACCOUNT);
  const perPage = opts.fbPerPage ?? (opts.full ? FULL_POSTS_PER_ACCOUNT : FB_REELS_PER_PAGE);
  let query = supabase
    .from("accounts")
    .select("id, handle, platform, status, avatar_updated_at")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")');
  // A list of accounts reads only those — a freshly added one, say.
  if (opts.accountIds?.length) query = query.in("id", opts.accountIds);
  // A parked account (0 reels a day) posts nothing and is out of every
  // chart; reading it every morning was money for nothing. Named on
  // purpose — a first read of a fresh account — it is still read.
  else query = query.gt("posts_per_day", 0);
  const { data: rows } = await query.order("platform").limit(MAX_ACCOUNTS);
  const accounts = (rows ?? []) as Account[];
  const ig = accounts.filter((a) => a.platform === "instagram");
  const fb = accounts.filter((a) => a.platform === "facebook");

  const [igReadings, fbReadings] = await Promise.all([
    readInstagram(ig, perAccount),
    readFacebook(fb, perPage),
  ]);
  const readings = [...igReadings, ...fbReadings];
  for (const r of readings) {
    const extra = opts.extraCodes?.[r.account.id];
    if (extra?.length) r.extraCodes = [...(r.extraCodes ?? []), ...extra];
  }
  await fillHiddenReels(supabase, readings);
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

    // The screenshot readings from before the scrape stay: they are the
    // only history an account has for the months before it was first read
    // here. The dashboard uses them up to the day of the first scrape and
    // the scrape rows from then on, so the two never meet on one day.

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

  // Profile pictures, at most once a week per account — they rarely change.
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const r of readings) {
    if (!r.avatarUrl) continue;
    const last = r.account.avatar_updated_at ? new Date(r.account.avatar_updated_at).getTime() : 0;
    if (last > weekAgo) continue;
    const path = await storeImage(
      supabase,
      r.avatarUrl,
      `personas/${personaId}/accounts/${r.account.id}/avatar-${today}.jpg`
    );
    if (path) {
      await supabase
        .from("accounts")
        .update({ avatar_path: path, avatar_updated_at: now })
        .eq("id", r.account.id);
    }
  }
  // Covers into storage while the CDN addresses from this run are fresh.
  const covers = await storeCovers(supabase, personaId, (opts.deadline ?? Date.now() + 60_000));
  if (covers.pending > 0) notes.push(`${covers.pending} covers left for the next run`);

  const viaFeed = readings.filter((r) => r.viaFeed).length;
  const estimatedUsd =
    ig.length * 0.0026 +
    ig.length * (0.002 + perAccount * 0.0015) +
    fb.length * 0.012 +
    (fb.length ? 0.0005 + (fb.length - viaFeed) * perPage * 0.0003 : 0) +
    (viaFeed ? 0.001 + viaFeed * perPage * 0.005 : 0);
  console.log(
    `[scrape] persona ${personaId}: ${accounts.length} accounts, ${posts} posts, ${matched} matched, ~$${estimatedUsd.toFixed(3)}` +
      (notes.length ? ` — ${notes.join("; ")}` : "")
  );
  return { accounts: accounts.length, posts, matched, estimatedUsd, notes };
}
