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

/** The function has sixty seconds; leave room to write the results away. */
const RUN_TIMEOUT_MS = 45_000;

export type PostState = "alive" | "unreachable" | "unknown";

type Row = {
  ok?: boolean;
  errorCode?: string;
  shortCode?: string;
  inputUrl?: string;
};

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
      body: JSON.stringify({ postUrls: urls, maxItems: urls.length }),
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
export const CONTROL_SHORTCODE = "CzZzZzZzZzZ";
export const CONTROL_URL = `https://www.instagram.com/p/${CONTROL_SHORTCODE}/`;
