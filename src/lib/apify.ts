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
 * $0.0017 for the post plus $0.001 for its details — $0.0027 a link, dead
 * linear, with no fixed cost at all. Measured on the bills: 3 links $0.0081,
 * 14 links $0.0378, 72 links $0.1944. Apify's platform charges (compute,
 * proxy, storage) come to exactly $0.00 on every one of those runs, because
 * this actor's developer absorbs them.
 *
 * That last clause is the whole reason this actor is here and not
 * crawlerbros/instagram-post-scraper, which was tried and looked cheaper on
 * the shelf at $0.001 a result. Its listing sets
 * isPPEPlatformUsagePaidByUser, so the platform bill lands on us: for 72
 * links that was $0.02 of start events, $0.072 of results — and $0.0999 of
 * residential proxy traffic on top, $0.21 all told. Decomposed over two runs
 * it comes to about $0.040 fixed per run plus $0.0024 a link, which only
 * beats $0.0027 a link once a run carries more than 133 of them. We will
 * never ask about 133 at once, so it never wins.
 *
 * What crawlerbros does have is speed — 76 seconds for the same 72 links
 * against 325 — and a third verdict, age_restricted, where this one can only
 * say restricted_page. Neither is worth $0.04 a day: slowness stopped
 * costing anything once runs began to be harvested rather than abandoned,
 * and both "restricted" answers mean the same thing here, namely that
 * somebody put something there and it is still there.
 */
const PAID_ACTOR = "apify~instagram-post-scraper";
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
 * Links handed to the paid pass in one run — a runaway brake, not the pace.
 *
 * What normally keeps this small is the caller's rule about *when* a link is
 * worth buying an answer for; this is only here so that a rule which goes
 * wrong cannot go wrong expensively. Twenty-five links is under seven cents,
 * and a month in which every single run hit the brake would come to $2.
 *
 * The cap was 150 while the price was believed to be dominated by a fixed
 * start-up. It is not — it is $0.0027 a link and nothing else — so an
 * unbounded batch was simply an unbounded bill.
 */
export const PAID_BATCH = 25;

export type PostState = "alive" | "unreachable" | "unknown";

/**
 * Both shapes this has had to read. The field names differ between actors
 * and datasets outlive the decision about which actor to use, so a harvest
 * has to understand whatever it finds lying about.
 */
type Row = {
  /** apify/instagram-post-scraper */
  error?: string;
  url?: string;
  shortCode?: string;
  inputUrl?: string;
  /** crawlerbros/instagram-post-scraper */
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
    const code =
      row.shortCode ??
      row.shortcode ??
      instagramKey(row.url ?? row.inputUrl ?? row.post_url ?? "");
    if (!code) continue;

    const gone = row.error === "not_found" || row.status === "not_found";
    // A row of post data, or an honest "something is in my way" —
    // restricted_page from one actor, age_restricted from the other. Either
    // way somebody put something there and it is still there. Only "not
    // found" is a death certificate.
    const blocked = row.error === "restricted_page" || row.status === "age_restricted";
    const data = Boolean(row.shortCode ?? row.shortcode);

    if (gone) into.set(code, "unreachable");
    else if (blocked || data || (!row.error && !row.status)) into.set(code, "alive");
    // Anything else is the scraper having a bad day, not a verdict.
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
        // "username" is what this actor calls a list of post URLs. The set
        // is not decoration: the same post is often linked from several
        // messages, and this one rejects the whole batch over a single
        // repeat — "must NOT have duplicate items". One run died exactly
        // that way, and with no second pass there was no verdict for the
        // control post either, so the guards reported a live control on top.
        username: Array.from(new Set(urls)),
        resultsLimit: urls.length,
        ...(cookies ? { sessionCookies: JSON.parse(cookies) } : {}),
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
