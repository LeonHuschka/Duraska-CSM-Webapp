import "server-only";

/**
 * Every Apify run goes through here, across more than one account.
 *
 * Each account carries its own monthly budget; once it is spent Apify
 * refuses every start with a 403 "Monthly usage hard limit exceeded". The
 * run then simply goes to the next account, and a spent account is skipped
 * for as long as this server instance lives — a fresh one asks it again,
 * which costs nothing and finds it refilled when its month turns over.
 *
 * Accounts: APIFY_TOKEN, then APIFY_TOKEN_2.
 */
const spent = new Set<string>();

function tokens(): string[] {
  return [process.env.APIFY_TOKEN, process.env.APIFY_TOKEN_2].filter((t): t is string => !!t);
}

/**
 * Start an actor and wait for its dataset: POST run-sync-get-dataset-items
 * with `input`, plus any extra query parameters. Answers with the last
 * response Apify gave, or null when no account is configured.
 */
export async function apifyRunSync(
  actor: string,
  input: unknown,
  opts: { query?: Record<string, string | number | undefined>; signal?: AbortSignal } = {}
): Promise<Response | null> {
  const all = tokens();
  const usable = all.filter((t) => !spent.has(t));
  let last: Response | null = null;
  for (const token of usable.length ? usable : all) {
    const q = new URLSearchParams({ token });
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v != null) q.set(k, String(v));
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: opts.signal,
    });
    if ((res.status === 402 || res.status === 403) && /usage/i.test(await res.clone().text())) {
      spent.add(token);
      console.warn(`[apify] account ${all.indexOf(token) + 1} is out of budget, trying the next`);
      last = res;
      continue;
    }
    return res;
  }
  return last;
}
