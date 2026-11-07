import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { ownMedia, recentMediaIds } from "@/lib/instagram-api";

type Sb = SupabaseClient<Database>;

/**
 * The reels of the accounts connected for auto-posting, read through the
 * account's own API access after the morning scrape. The scrape sees what
 * anyone sees on the profile; a trial reel is not on the profile, so only
 * this way do its plays arrive. A reel both read is kept as the API says —
 * its numbers are the account's own. The planner's posts bring their job
 * along, so they need no matching.
 */
const DAYS = 45;

export async function readOwnMedia(supabase: Sb, personaId: string): Promise<{ reels: number; notes: string[] }> {
  const out = { reels: 0, notes: [] as string[] };
  const [{ data: all }, { data: live }] = await Promise.all([
    supabase.from("ig_connections").select("account_id, ig_user_id, access_token").eq("persona_id", personaId),
    supabase.from("accounts").select("id").eq("persona_id", personaId).not("status", "in", '("dead","paused")'),
  ]);
  const inUse = new Set((live ?? []).map((a) => a.id));
  const conns = (all ?? []).filter((c) => inUse.has(c.account_id));
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  for (const c of conns) {
    const { data: slots } = await supabase
      .from("schedule_slots")
      .select("ig_media_id, request_id, asset_id")
      .eq("account_id", c.account_id)
      .eq("status", "posted")
      .not("ig_media_id", "is", null)
      .gte("posted_at", new Date(Date.now() - DAYS * 86_400_000).toISOString());
    const job = new Map((slots ?? []).map((s) => [s.ig_media_id!, s]));
    const ids = Array.from(new Set([...Array.from(job.keys()), ...(await recentMediaIds(c.ig_user_id, c.access_token))]));

    const rows: Database["public"]["Tables"]["reel_metrics"]["Insert"][] = [];
    for (const id of ids) {
      const m = await ownMedia(id, c.access_token);
      if (!m || !m.shortcode || m.kind !== "REELS") continue;
      if (m.timestamp && Date.now() - new Date(m.timestamp).getTime() > DAYS * 86_400_000) continue;
      const s = job.get(id);
      rows.push({
        persona_id: personaId,
        account_id: c.account_id,
        captured_at: now,
        position: rows.length + 1,
        shortcode: m.shortcode,
        post_url: m.permalink,
        posted_at: m.timestamp,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        caption: m.caption,
        tile_path: m.thumbnail,
        request_id: s?.request_id ?? null,
        asset_id: s?.asset_id ?? null,
        match_method: s ? "planner" : null,
        match_confirmed: !!s,
        source: "scrape",
        confidence: 1,
        needs_review: false,
      });
    }
    if (!rows.length) {
      if (ids.length) out.notes.push(`${c.account_id}: the API gave no reels for ${ids.length} posts`);
      continue;
    }
    // Today's reading of these reels is the API's, in place of the scrape's.
    await supabase
      .from("reel_metrics")
      .delete()
      .eq("account_id", c.account_id)
      .eq("source", "scrape")
      .gte("captured_at", `${today}T00:00:00Z`)
      .in("shortcode", rows.map((r) => r.shortcode!));
    const { error } = await supabase.from("reel_metrics").insert(rows);
    if (error) out.notes.push(`${c.account_id}: not stored — ${error.message}`);
    else out.reels += rows.length;
  }
  return out;
}
