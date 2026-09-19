import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * The pipeline in the numbers that decide whether anyone needs a nudge.
 *
 * "Ready" is counted twice on purpose. Cuts is what the VAs post, reels is
 * how many different things those cuts are — four cuts of one reel is a
 * day of posting, not four. Both are SFW and unposted, the same rule as
 * the vault's "Ready to post", so the alert and the app agree.
 */
export type Pool = {
  manager: string | null;
  /** Reels with a free cut and at least one of her accounts still open. */
  reels: number;
  cuts: number;
  /** Of those, reels that have not run on any of her accounts yet. */
  fresh: number;
  accounts: number;
};

export type PipelineCounts = {
  /**
   * Reels the tightest poster can still use. A cut goes out once and a reel
   * runs once per account, so a free cut is only work for a VA whose
   * accounts have not had that reel yet. Ten reels with free cuts are no
   * buffer at all if nine of them already ran on her accounts.
   */
  readyReels: number;
  /** Free cuts within those reels. */
  readyCuts: number;
  /** The same per poster, so the alert can say whose pool is low. */
  pools: Pool[];
  /** Jobs shot and uploaded, waiting for a cut. */
  toEdit: number;
  /** Inspo links nobody has reacted to yet. */
  openLinks: number;
  /** Links marked shot whose takes have not been uploaded. */
  shotNotUploaded: number;
};

export async function pipelineCounts(
  supabase: SupabaseClient<Database>,
  personaId: string
): Promise<PipelineCounts> {
  const [{ data: requests }, { data: links }, { data: slots }, { data: accounts }] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, status, is_nsfw")
      .eq("persona_id", personaId),
    supabase.from("content_links").select("status").eq("persona_id", personaId),
    supabase
      .from("schedule_slots")
      .select("request_id, asset_id, account_id")
      .eq("persona_id", personaId)
      .eq("status", "posted"),
    supabase
      .from("accounts")
      .select("id, manager_username, posts_per_day")
      .eq("persona_id", personaId)
      .not("status", "in", '("dead","paused")'),
  ]);
  const reqs = requests ?? [];
  const ids = reqs.map((r) => r.id);
  const { data: assets } = ids.length
    ? await supabase
        .from("content_assets")
        .select("id, request_id, stage")
        .in("request_id", ids)
        .is("deleted_at", null)
    : { data: [] as { id: string; request_id: string | null; stage: string }[] };

  const postedCuts = new Set<string>();
  const postedRequestsLegacy = new Set<string>();
  for (const s of slots ?? []) {
    if (s.asset_id) postedCuts.add(s.asset_id);
    else if (s.request_id) postedRequestsLegacy.add(s.request_id);
  }
  const nsfw = new Set(reqs.filter((r) => r.is_nsfw).map((r) => r.id));
  const ready = (assets ?? []).filter(
    (a) =>
      a.stage === "edited" &&
      a.request_id &&
      !nsfw.has(a.request_id) &&
      !postedCuts.has(a.id) &&
      !postedRequestsLegacy.has(a.request_id)
  );
  const hasRaw = new Set(
    (assets ?? []).filter((a) => a.stage === "raw" && a.request_id).map((a) => a.request_id)
  );

  // Which reel has already run where.
  const ranOn = new Set<string>();
  for (const sl of slots ?? []) {
    if (sl.request_id && sl.account_id) ranOn.add(`${sl.request_id}|${sl.account_id}`);
  }
  // One pool per poster: the accounts she actually posts to.
  const norm = (h: string | null) => (h ?? "").trim().replace(/^@/, "").toLowerCase() || null;
  const posting = (accounts ?? []).filter((a) => Number(a.posts_per_day ?? 0) > 0);
  const byManager = new Map<string | null, string[]>();
  for (const a of posting) {
    const m = norm(a.manager_username);
    byManager.set(m, [...(byManager.get(m) ?? []), a.id]);
  }
  const pools: Pool[] = Array.from(byManager.entries()).map(([manager, ids]) => {
    const mine = ready.filter((a) => ids.some((id) => !ranOn.has(`${a.request_id}|${id}`)));
    const untouched = mine.filter((a) => ids.every((id) => !ranOn.has(`${a.request_id}|${id}`)));
    return {
      manager,
      reels: new Set(mine.map((a) => a.request_id)).size,
      cuts: mine.length,
      fresh: new Set(untouched.map((a) => a.request_id)).size,
      accounts: ids.length,
    };
  });
  // No posting accounts configured: fall back to the plain count.
  const tightest =
    pools.length > 0
      ? pools.reduce((lo, p) => (p.reels < lo.reels ? p : lo))
      : { manager: null, reels: new Set(ready.map((a) => a.request_id)).size, cuts: ready.length };

  return {
    readyReels: tightest.reels,
    readyCuts: tightest.cuts,
    pools,
    toEdit: reqs.filter((r) => r.status === "shooted" && hasRaw.has(r.id)).length,
    openLinks: (links ?? []).filter((l) => l.status === "open").length,
    shotNotUploaded: (links ?? []).filter((l) => l.status === "shot").length,
  };
}
