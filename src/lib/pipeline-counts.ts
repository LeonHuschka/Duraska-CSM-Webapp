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
export type PipelineCounts = {
  /** Distinct reels with at least one unposted SFW cut. */
  readyReels: number;
  /** Unposted SFW cuts. */
  readyCuts: number;
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
  const [{ data: requests }, { data: links }, { data: slots }] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, status, is_nsfw")
      .eq("persona_id", personaId),
    supabase.from("content_links").select("status").eq("persona_id", personaId),
    supabase
      .from("schedule_slots")
      .select("request_id, asset_id")
      .eq("persona_id", personaId)
      .eq("status", "posted"),
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

  return {
    readyReels: new Set(ready.map((a) => a.request_id)).size,
    readyCuts: ready.length,
    toEdit: reqs.filter((r) => r.status === "shooted" && hasRaw.has(r.id)).length,
    openLinks: (links ?? []).filter((l) => l.status === "open").length,
    shotNotUploaded: (links ?? []).filter((l) => l.status === "shot").length,
  };
}
