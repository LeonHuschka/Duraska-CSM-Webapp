import "server-only";
import { instagramKey } from "@/lib/telegram";

/**
 * Asking a logged-out scraper whether an Instagram post still exists.
 *
 * Measured before this was written, against four posts of known state:
 * a live public one, one that is live but age-restricted, one Leon deleted
 * by hand, and a shortcode that never existed. The scraper answers `ok` for
 * ordinary public posts and NOT_FOUND for the other three alike — its own
 * error text says so: "does not exist, or is private, deleted or
 * suspended". So NOT_FOUND is not proof of deletion, and the job on top of
 * this treats it as suspicion that has to survive several days.
 *
 * Two properties of the pricing shape the design:
 *   - the run start is charged per gigabyte, so every link goes into ONE
 *     run rather than one run per link — that is four times cheaper;
 *   - NOT_FOUND rows are not charged at all, which is why re-checking a
 *     suspicious link on later runs costs nothing.
 */

const ACTOR = "dami_studio~instagram-post-scraper";
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

/**
 * The cheap pass. It has answered in six to nine seconds every time it has
 * been measured, so this is a stuck-connection cutoff, not a budget.
 */
const RUN_TIMEOUT_MS = 20_000;

/**
 * How long a run may take in total before results are written away.
 *
 * This was 45 seconds, carved out of a minute I believed was the ceiling.
 * It is not: Hobby functions may run for 300 seconds. The detailed scraper
 * needs 31 to 56 depending on its own start-up, so under the old figure it
 * was being cut off just short of finishing, run after run — the cause of
 * "zweiter Durchgang ohne Antwort in 36s" and of a report that condemned 35
 * posts on the cheap pass's word alone.
 *
 * Four minutes leaves the slowest measured run a wide margin and still ends
 * a wedged connection well inside the platform's limit.
 */
export const RUN_DEADLINE_MS = 240_000;

export type PostState = "alive" | "unreachable" | "unknown";

type Row = {
  ok?: boolean;
  errorCode?: string;
  shortCode?: string;
  inputUrl?: string;
};

/**
 * An Instagram session for the scraper to use, as exported cookies.
 *
 * Without one this cannot do the job it was brought in for. Measured on the
 * real backlog, 59 of 106 links came back "not found" logged out, and the
 * one link in that set we had verified by hand was live — Instagram hides
 * age-restricted posts and restricted accounts from anyone not signed in,
 * and most of what these models re-shoot is exactly that. Logged in, "not
 * found" means what it says.
 *
 * Set INSTAGRAM_SESSION_COOKIES to the cookie array as JSON. Malformed
 * content is ignored rather than thrown, because a bad paste must not stop
 * the check from running at all.
 */
function sessionCookies(): unknown[] | null {
  const raw = process.env.INSTAGRAM_SESSION_COOKIES;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    console.warn("[apify] INSTAGRAM_SESSION_COOKIES is not valid JSON — ignoring it");
    return null;
  }
}

/**
 * One run, every link. Keys are Instagram shortcodes; anything the run did
 * not answer for is absent, which callers must read as "no verdict" rather
 * than as bad news.
 */
export async function checkPosts(
  urls: string[]
): Promise<{ states: Map<string, PostState>; error: string | null }> {
  const states = new Map<string, PostState>();
  if (urls.length === 0) return { states, error: null };

  const token = process.env.APIFY_TOKEN;
  if (!token) return { states, error: "APIFY_TOKEN is not set" };

  let rows: Row[];
  try {
    const res = await fetch(`${ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postUrls: urls,
        maxItems: urls.length,
        ...(sessionCookies() ? { sessionCookies: sessionCookies() } : {}),
      }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { states, error: `apify http ${res.status}` };
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { states, error: "apify returned no rows" };
    rows = body as Row[];
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      states,
      error: timedOut
        ? `no answer within ${RUN_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : "apify call failed",
    };
  }

  for (const row of rows) {
    const code = row.shortCode ?? (row.inputUrl ? instagramKey(row.inputUrl) : null);
    if (!code) continue;
    if (row.ok === true) states.set(code, "alive");
    else if (row.errorCode === "NOT_FOUND") states.set(code, "unreachable");
    // Any other error is the scraper having a bad day, not a verdict.
  }

  return { states, error: null };
}

/**
 * A shortcode that has never belonged to a post, sent along with every
 * batch. It has to come back unreachable; if the run claims it is alive,
 * the answers are not about the posts we asked for and nothing may be
 * deleted on their strength. NOT_FOUND rows are free, so this costs
 * nothing.
 */
/**
 * What this month has cost so far, against the free plan's ceiling.
 *
 * The expensive pass is the only part that can run the credit down, and
 * nothing was stopping it. Apify knows the real figure, so it is asked
 * rather than estimated — an estimate would drift exactly when it mattered.
 */
export async function monthlySpend(): Promise<{ used: number; limit: number } | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.apify.com/v2/users/me/limits?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } };
    };
    const used = body.data?.current?.monthlyUsageUsd;
    const limit = body.data?.limits?.maxMonthlyUsageUsd;
    if (typeof used !== "number" || typeof limit !== "number") return null;
    return { used, limit };
  } catch {
    return null;
  }
}

/**
 * Above this share of the month's credit, the expensive pass is skipped.
 *
 * The cheap pass and the age rule keep working — those cost almost nothing
 * and the age rule costs nothing at all — so a month that runs hot loses
 * the ability to tell deleted from hidden, not the cleanup itself.
 */
export const SPEND_CEILING_SHARE = 0.7;

export const CONTROL_SHORTCODE = "CzZzZzZzZzZ";
export const CONTROL_URL = `https://www.instagram.com/p/${CONTROL_SHORTCODE}/`;

/**
 * The second opinion, for links the cheap pass could not see.
 *
 * Apify's own Instagram scraper answers a question the cheap one cannot:
 * it separates a post that is gone from one that exists but is hidden.
 *
 *   not_found        the post does not exist
 *   restricted_page  it exists; the scraper may not see all of it
 *
 * Measured against the 58 links the cheap pass called missing: 30 came back
 * restricted and 28 not found — and the one link in that set Leon had
 * opened and confirmed alive was among the restricted. That is the whole
 * difference between this working and the August incident.
 *
 * Priced at $0.0013 a post against the cheap pass's $0.00018. Every
 * Instagram actor in the store that accepts post URLs was measured for this:
 * of the ones cheaper than this, apidojo's answers post URLs with
 * {noResults:true}, and the two at a third of the price take profile names
 * only. This is the cheapest one that both takes a link and knows the
 * difference, which is why it still only ever sees what the first pass
 * could not settle.
 */
const DETAIL_ACTOR = "apify~instagram-api-scraper";
const DETAIL_ENDPOINT = `https://api.apify.com/v2/acts/${DETAIL_ACTOR}/run-sync-get-dataset-items`;

/** 58 links took 44 seconds, so this many keeps a run inside the minute. */
export const DETAIL_BATCH = 35;

export async function checkPostsDetailed(
  urls: string[],
  /** What is left of the function's minute — see the caller. */
  timeoutMs: number
): Promise<{ states: Map<string, PostState>; error: string | null }> {
  const states = new Map<string, PostState>();
  if (urls.length === 0) return { states, error: null };
  if (timeoutMs < 8_000) {
    return { states, error: "zu wenig Zeit für den zweiten Durchgang" };
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) return { states, error: "APIFY_TOKEN is not set" };

  let rows: (Row & { error?: string; url?: string; type?: string })[];
  try {
    const res = await fetch(`${DETAIL_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directUrls: urls, resultsType: "details", resultsLimit: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { states, error: `apify detail http ${res.status}` };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { states, error: "apify detail returned no rows" };
    rows = body as typeof rows;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      states,
      error: timedOut
        ? `zweiter Durchgang ohne Antwort in ${Math.round(timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : "apify detail call failed",
    };
  }

  for (const row of rows) {
    const code =
      row.shortCode ??
      (row.url ? instagramKey(row.url) : null) ??
      (row.inputUrl ? instagramKey(row.inputUrl) : null);
    if (!code) continue;
    if (row.error === "not_found") states.set(code, "unreachable");
    // Restricted, or an actual row of post data: either way it exists.
    else if (!row.error || row.error === "restricted_page") states.set(code, "alive");
    // Anything else is the scraper having a bad day, not a verdict.
  }

  return { states, error: null };
}
