import "server-only";
import { checkInstagramAlive, instagramKey } from "@/lib/telegram";
import type { PostState } from "@/lib/apify";

/**
 * Asking Instagram directly, which costs nothing.
 *
 * This used to be the whole check and was abandoned last August, when
 * Instagram answered this host with a login wall whatever it was asked. It
 * answers again — measured from production on 2026-08-31 against a post
 * known to be public and live, which came back with its media tags intact.
 *
 * So the paid first pass is gone. It was $0.00018 a link and the single
 * largest line on the bill, spent on a question the server can ask for
 * free. What survives it is the shape of the answer, which was always the
 * useful part:
 *
 *   alive    the page carries the post's own media tags. Measured at 17 of
 *            17 on public posts, and it is the only thing this can prove.
 *   unknown  everything else. Deleted, private, age-restricted and
 *            rate-limited all look identical from outside a login, which is
 *            what the paid second pass is for.
 *
 * It never returns "unreachable": absence of evidence here is not evidence,
 * and reading it as one is what nearly cost fifty-two good links in August.
 */

/**
 * Gentle on purpose.
 *
 * Six at a time over a hundred links got every single one refused, minutes
 * after the same request against a single post came back with its media
 * intact. Instagram answers a trickle and closes the door on a flood, so
 * this asks slowly and gives up on the clock rather than pushing harder —
 * whatever it does not get to is simply somebody else's job.
 */
const CONCURRENCY = 2;
const PAUSE_MS = 400;

/** Past this the rest goes to the paid passes; the run has other work. */
const BUDGET_MS = 70_000;

export async function checkPostsDirect(
  urls: string[]
): Promise<{ states: Map<string, PostState>; error: string | null }> {
  const states = new Map<string, PostState>();
  if (urls.length === 0) return { states, error: null };

  const queue = [...urls];
  const deadline = Date.now() + BUDGET_MS;
  let asked = 0;
  let answered = 0;
  let refusedInARow = 0;

  async function worker() {
    for (;;) {
      if (Date.now() > deadline) return;
      // Once it starts refusing it keeps refusing, and every further request
      // is a second spent for nothing.
      if (refusedInARow >= 8) return;
      const url = queue.shift();
      if (!url) return;
      const code = instagramKey(url);
      if (!code) continue;
      const { alive } = await checkInstagramAlive(url);
      asked++;
      if (alive === true) {
        states.set(code, "alive");
        answered++;
        refusedInARow = 0;
      } else {
        refusedInARow++;
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker)
  );

  console.log(`[probe] direkt gefragt: ${asked}, beantwortet: ${answered}`);
  return { states, error: null };
}
