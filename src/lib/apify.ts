import "server-only";
import { instagramKey } from "@/lib/telegram";

/**
 * Asking a scraper whether an Instagram post still exists.
 *
 * There is one paid pass now, where there were two. It replaced both because
 * it is cheaper than either and answers a question neither could:
 *
 *   a row with post data   the post exists and is public
 *   status age_restricted  it exists, behind an age gate
 *   status not_found       it is gone
 *
 * That middle state is the whole problem in one word. Logged out, a deleted
 * post and an age-gated one look identical, and most of what these models
 * re-shoot is age-gated — which is how an earlier version came to condemn 59
 * of 106 links, one of them opened by hand and plainly alive.
 *
 * Measured against 72 real backlog links whose truth was already bought from
 * the $0.0027 actor: all 40 public ones agreed, all 12 deleted ones agreed,
 * and of the 20 the expensive actor could only shrug at ("restricted_page",
 * meaning "something stopped me"), this one named 16 as age-gated outright.
 * The remaining four it calls deleted — see the note on PAID_ACTOR.
 */

/**
 * $0.001 a result plus $0.005 a run, and 50 seconds of start-up before it
 * hits its stride: 6 links took 52 seconds, 72 took 76. So a batch is nearly
 * free once it is moving, and the number that costs money is how many links
 * are ever asked about — not how they are grouped.
 *
 * The actor it replaced billed $0.0027 a row, dead linear, no start-up to
 * amortise: 3 rows $0.0081, 14 rows $0.0378, 72 rows $0.1944. Same 72 links
 * took it 325 seconds, which is how a run came to outlive its caller by
 * three seconds and bill $0.19 for a verdict nobody read.
 *
 * One caveat, recorded because it is the one thing here not settled by
 * measurement: on four links the old actor said "restricted" and this one
 * says "not found". Nothing available from a logged-out host can adjudicate
 * that — Instagram's embed endpoint returns the same 620 KB login shell for
 * a live post, a dead one and a shortcode that never existed. This one has
 * the finer instrument and used it 16 times rather than reaching for
 * not_found, so it gets the benefit of the doubt; and being wrong costs a
 * 💔 that someone can take off again.
 */
const PAID_ACTOR = "crawlerbros~instagram-post-scraper";
const PAID_ENDPOINT = `https://api.apify.com/v2/acts/${PAID_ACTOR}/run-sync-get-dataset-items`;

/**
 * How long a run may take in total before results are written away.
 *
 * Hobby functions may run for 300 seconds — this was once set to 45 out of a
 * minute I wrongly believed was the ceiling, which cut the scraper off just
 * short of finishing, run after run.
 */
export const RUN_DEADLINE_MS = 240_000;

/**
 * Links handed to the paid pass in one run.
 *
 * This is the only tap in the system that money comes out of, so it is the
 * only place a ceiling belongs. Forty-five covers a whole realistic backlog
 * in a single run — which is what was asked for — and caps the worst
 * imaginable day at about five cents. A month in which every single run had
 * to fall back this far would cost $1.50; the ordinary month, where the free
 * probe answers most of it and only the day's new links get this far, costs
 * around twenty cents.
 *
 * The previous cap was 150, set when the price was believed to be dominated
 * by a fixed start-up. It was not, so an unbounded batch was an unbounded
 * bill.
 */
export const PAID_BATCH = 45;

export type PostState = "alive" | "unreachable" | "unknown";

type Row = {
  status?: string;
  shortcode?: string;
  post_url?: string;
};

/**
 * An Instagram session for the scraper to use, as exported cookies.
 *
 * Optional — the actor authenticates itself well enough that the measured
 * numbers above were all taken without one. Set INSTAGRAM_SESSION_COOKIES to
 * the cookie array as JSON to lend it yours. A malformed value is ignored
 * rather than thrown, because a bad paste must not stop the check running.
 */
function sessionCookies(): string | null {
  const raw = process.env.INSTAGRAM_SESSION_COOKIES;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? JSON.stringify(parsed) : null;
  } catch {
    console.warn("[apify] INSTAGRAM_SESSION_COOKIES is not valid JSON — ignoring it");
    return null;
  }
}

/**
 * Read a run's rows into verdicts. Anything it did not answer for is simply
 * absent, which callers must read as "no verdict" rather than as bad news.
 */
function readRows(rows: Row[], into: Map<string, PostState>) {
  for (const row of rows) {
    const code = row.shortcode ?? (row.post_url ? instagramKey(row.post_url) : null);
    if (!code) continue;
    if (row.status === "not_found") into.set(code, "unreachable");
    // Post data, or an honest "there is an age gate in my way": either way
    // somebody put something there and it is still there.
    else if (row.shortcode || row.status === "age_restricted") into.set(code, "alive");
    // Any other status is the scraper having a bad day, not a verdict.
  }
}

/** The paid pass. One run, every link it is given. */
export async function checkPostsPaid(
  urls: string[],
  /** What is left of the function's budget — see the caller. */
  timeoutMs: number
): Promise<{ states: Map<string, PostState>; error: string | null }> {
  const states = new Map<string, PostState>();
  if (urls.length === 0) return { states, error: null };
  if (timeoutMs < 8_000) return { states, error: "zu wenig Zeit für den Scraper" };

  const token = process.env.APIFY_TOKEN;
  if (!token) return { states, error: "APIFY_TOKEN is not set" };

  const cookies = sessionCookies();
  let rows: Row[];
  try {
    const res = await fetch(`${PAID_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // The same post is often linked from several messages. This actor
        // de-duplicates silently; its predecessor rejected the whole batch
        // over one repeat, and one run died exactly that way.
        post_urls: Array.from(new Set(urls)),
        ...(cookies ? { cookies } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { states, error: `apify http ${res.status}` };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { states, error: "apify returned no rows" };
    rows = body as Row[];
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      states,
      error: timedOut
        ? `Scraper ohne Antwort in ${Math.round(timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : "apify call failed",
    };
  }

  readRows(rows, states);
  return { states, error: null };
}

/**
 * Answers we have already paid for.
 *
 * Abandoning the HTTP request does not cancel the run: it finishes on
 * Apify's side, bills in full, and leaves its dataset sitting there for a
 * week. That is precisely what happened on 1 September — 325 seconds, $0.19,
 * 72 verdicts, and the caller gave up at 231. The next run then bought the
 * same 82 answers over again.
 *
 * So before spending anything, take what is already bought. Listing runs and
 * reading datasets is free, and applying a verdict twice changes nothing, so
 * this needs no bookkeeping of its own — no column, no run id to remember,
 * nothing that can drift out of step with reality.
 *
 * Each run is judged by its own control post before a single one of its rows
 * is believed: a run that cannot tell a fabricated shortcode from a real one
 * has nothing worth saying about either.
 */
export async function harvestRecentRuns(
  windowMs: number
): Promise<{ states: Map<string, PostState>; runs: number }> {
  const states = new Map<string, PostState>();
  const token = process.env.APIFY_TOKEN;
  if (!token) return { states, runs: 0 };

  const auth = `token=${encodeURIComponent(token)}`;
  let items: { id: string; finishedAt?: string; defaultDatasetId?: string }[];
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${PAID_ACTOR}/runs?${auth}&status=SUCCEEDED&desc=1&limit=5`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return { states, runs: 0 };
    const body = (await res.json()) as { data?: { items?: typeof items } };
    items = body.data?.items ?? [];
  } catch {
    return { states, runs: 0 };
  }

  const cutoff = Date.now() - windowMs;
  const recent = items.filter(
    (r) => r.defaultDatasetId && r.finishedAt && Date.parse(r.finishedAt) >= cutoff
  );
  // Oldest first, so that when two runs both saw a link the newer one wins.
  recent.reverse();

  let runs = 0;
  for (const run of recent) {
    let rows: Row[];
    try {
      const res = await fetch(
        `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?${auth}&limit=1000`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) continue;
      const body: unknown = await res.json();
      if (!Array.isArray(body)) continue;
      rows = body as Row[];
    } catch {
      continue;
    }

    const own = new Map<string, PostState>();
    readRows(rows, own);
    if (own.get(CONTROL_SHORTCODE) !== "unreachable") {
      console.warn(
        `[apify] harvest: run ${run.id} did not place the control post — ignoring its ${own.size} rows`
      );
      continue;
    }
    own.forEach((state, code) => states.set(code, state));
    runs++;
  }

  if (runs > 0) {
    console.log(`[apify] harvest: ${states.size} Urteile aus ${runs} bezahlten Läufen`);
  }
  return { states, runs };
}

/**
 * What this month has cost so far, against the free plan's ceiling.
 *
 * Apify knows the real figure, so it is asked rather than estimated — an
 * estimate would drift exactly when it mattered. It is read after the paid
 * pass, not before, or the report quotes a number that predates the run it
 * is reporting on.
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
 * Above this share of the month's credit, the paid pass is skipped.
 *
 * The free probe and the age rule keep working — they cost nothing at all —
 * so a month that runs hot loses the ability to tell deleted from hidden,
 * not the cleanup itself.
 */
export const SPEND_CEILING_SHARE = 0.7;

/**
 * A shortcode that has never belonged to a post, sent with every batch and
 * required to come back missing. If a run claims it is alive, that run's
 * answers are not about the posts we asked for and nothing may be marked on
 * their strength.
 */
export const CONTROL_SHORTCODE = "CzZzZzZzZzZ";
export const CONTROL_URL = `https://www.instagram.com/p/${CONTROL_SHORTCODE}/`;
