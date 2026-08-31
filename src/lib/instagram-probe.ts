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

/** Enough to sweep a backlog quickly without hammering one host. */
const CONCURRENCY = 6;

export async function checkPostsDirect(
  urls: string[]
): Promise<{ states: Map<string, PostState>; error: string | null }> {
  const states = new Map<string, PostState>();
  if (urls.length === 0) return { states, error: null };

  const queue = [...urls];
  let answered = 0;

  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const code = instagramKey(url);
      if (!code) continue;
      const { alive } = await checkInstagramAlive(url);
      if (alive === true) {
        states.set(code, "alive");
        answered++;
      }
      // false and null alike mean "ask the one that can tell them apart".
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker)
  );

  // Nothing at all coming back reachable, over a batch of any size, means
  // the wall is back rather than that every post died overnight. Saying so
  // lets the run fall through to the paid pass with its eyes open.
  if (urls.length >= 10 && answered === 0) {
    return { states, error: "Instagram antwortet diesem Server nicht mehr direkt" };
  }
  return { states, error: null };
}
