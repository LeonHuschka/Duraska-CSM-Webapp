import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Pictures the platforms hand out — profile pictures, reel covers — live on
 * Meta's CDNs under addresses that stop working after a few days. Whatever
 * the dashboard shows is copied into our own storage the first time it is
 * seen, and shown from there for good.
 */
type Sb = SupabaseClient<Database>;
const BUCKET = "content-assets";

const ALLOWED = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)instagram\.com$/i, /(^|\.)facebook\.com$/i];

/** Fetch one image and put it at `path`. Returns the path, or null. */
export async function storeImage(supabase: Sb, url: string | null, path: string): Promise<string | null> {
  if (!url) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || !ALLOWED.some((re) => re.test(target.hostname))) return null;
  // lookaside answers with a login page to anyone without a session.
  if (/(^|\.)lookaside\.fbsbx\.com$/i.test(target.hostname)) return null;
  try {
    const res = await fetch(target, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 500 || bytes.byteLength > 5_000_000) return null;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** Run `job` over `items`, a few at a time, until the deadline. */
export async function eachUntil<T>(items: T[], deadline: number, job: (item: T) => Promise<void>, width = 6) {
  let i = 0;
  const lane = async () => {
    while (i < items.length && Date.now() < deadline) {
      const item = items[i++];
      await job(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return Math.min(i, items.length);
}

/**
 * Copy the covers of reels that have none stored yet, from the freshest
 * CDN address the scrape has for them. Every reading of the reel gets the
 * stored path, so whichever row the dashboard picks has it.
 */
export async function storeCovers(
  supabase: Sb,
  personaId: string,
  deadline: number
): Promise<{ stored: number; pending: number }> {
  // Fresh readings first: their CDN addresses are the ones still alive.
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: rows } = await supabase
    .from("reel_metrics")
    .select("account_id, shortcode, tile_path")
    .eq("persona_id", personaId)
    .eq("source", "scrape")
    .is("cover_path", null)
    .not("tile_path", "is", null)
    .not("shortcode", "is", null)
    .gte("captured_at", since)
    .order("captured_at", { ascending: false })
    .limit(2000);
  const { data: accounts } = await supabase.from("accounts").select("id, platform").eq("persona_id", personaId);
  const platformOf = new Map((accounts ?? []).map((a) => [a.id, a.platform]));
  const todo = new Map<string, { account: string; shortcode: string; url: string; platform: string }>();
  for (const r of rows ?? []) {
    const key = `${r.account_id}|${r.shortcode}`;
    if (todo.has(key) || !r.account_id || !r.shortcode || !r.tile_path) continue;
    todo.set(key, { account: r.account_id, shortcode: r.shortcode, url: r.tile_path, platform: platformOf.get(r.account_id) ?? "post" });
  }
  // A reel stored once under another reading needs no second download.
  const list = Array.from(todo.values());
  if (list.length === 0) return { stored: 0, pending: 0 };
  const { data: have } = await supabase
    .from("reel_metrics")
    .select("account_id, shortcode, cover_path")
    .eq("persona_id", personaId)
    .not("cover_path", "is", null)
    .in("shortcode", list.map((l) => l.shortcode));
  const known = new Map((have ?? []).map((h) => [`${h.account_id}|${h.shortcode}`, h.cover_path!]));

  let stored = 0;
  const done = await eachUntil(list, deadline, async (item) => {
    const path =
      known.get(`${item.account}|${item.shortcode}`) ??
      (await storeImage(
        supabase,
        item.url,
        `personas/${personaId}/covers/${item.platform}/${item.shortcode.replace(/[^A-Za-z0-9_-]/g, "_")}.jpg`
      ));
    if (!path) return;
    await supabase
      .from("reel_metrics")
      .update({ cover_path: path })
      .eq("account_id", item.account)
      .eq("shortcode", item.shortcode);
    stored++;
  });
  return { stored, pending: list.length - done };
}
