"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { linkInspoToRequest } from "@/lib/content-links";

// Cookie when valid, otherwise the user's first membership. Mobile users
// never get the cookie set (no persona switcher on phones), so relying on
// it alone used to break uploads entirely.
async function getPersonaId(): Promise<string> {
  return requireActivePersonaId();
}

/**
 * Compute the next title for self-produced content: "{ContentType} #N".
 *
 * Scans existing content_requests for the persona whose title matches
 * "{prefix} #<number>" — finds the max N and returns N+1. Falls back to
 * "Untitled" prefix when no content type is picked.
 *
 * Counts ALL requests with that prefix regardless of status / stage —
 * so the numbering doesn't reset when content moves through the pipeline.
 */
const REEL_PREFIX = "Reel";

export async function getNextReelTitle() {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  // Match "Reel #N" titles and return the next number. Reels are all just
  // copied IG reels — there's no meaningful classifier, so we only count.
  const { data: rows } = await supabase
    .from("content_requests")
    .select("title")
    .eq("persona_id", personaId)
    .ilike("title", `${REEL_PREFIX} #%`);

  let maxN = 0;
  const re = /^Reel\s*#(\d+)/i;
  for (const r of rows ?? []) {
    const m = r.title?.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }

  return { title: `${REEL_PREFIX} #${maxN + 1}` };
}

/**
 * Self-produced content: model (or any persona member) creates a new
 * content_request straight from the Vault, marked as already shot.
 * Returns the new request_id + persona_id so the client can run the
 * normal upload + asset-record flow.
 *
 * Title is generated server-side from the content type + auto-incremented
 * number — keeps naming consistent and avoids the model having to think
 * about it.
 *
 * stage="raw" + status="shooted" — fits the pipeline: model shoots based
 * on her own IG inspo → editor processes later → moves to "edited".
 */
export async function createSelfProducedRequest(data: {
  inspo_link?: string | null;
  /** What the reel is meant to be, in her words — only for own ideas. */
  notes?: string | null;
  is_nsfw: boolean;
  is_trial?: boolean;
  is_warmup?: boolean;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();
  const now = new Date().toISOString();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", request_id: null, title: null };

  // Simple auto-incrementing "Reel #N" — no classification.
  const { title } = await getNextReelTitle();

  // Find the next position so it lands at the top of "shooted" column
  const { data: maxRow } = await supabase
    .from("content_requests")
    .select("position")
    .eq("persona_id", personaId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from("content_requests")
    .insert({
      persona_id: personaId,
      title,
      // Her own brief when there is one — the editor has nothing else to
      // go on for a reel that exists only in her head.
      description:
        data.notes?.trim() ||
        (data.inspo_link ? "Self-produced based on inspo" : "Own idea"),
      inspo_link: data.inspo_link ?? null,
      content_type_id: null,
      is_nsfw: data.is_nsfw,
      is_trial: data.is_trial ?? false,
      is_warmup: data.is_warmup ?? false,
      status: "shooted",
      shooted_at: now,
      position: nextPosition,
      created_by: user.id,
    })
    .select("id, persona_id")
    .single();

  if (error || !inserted) {
    return { error: error?.message ?? "Insert failed", request_id: null, title: null };
  }

  // Match it back to the Telegram inspo link and react there. Never let this
  // break the upload.
  await linkInspoToRequest({
    personaId,
    requestId: inserted.id,
    inspoUrl: data.inspo_link ?? null,
  });

  return {
    error: null,
    request_id: inserted.id,
    persona_id: inserted.persona_id,
    title,
  };
}

/**
 * Persist a thumbnail_path produced by the client-side backfill flow.
 * The actual JPEG upload happens on the client (it has the file in memory)
 * — this just writes the resulting path back to the DB and revalidates.
 */
export async function saveAssetThumbnail(data: {
  asset_id: string;
  thumbnail_path: string;
}) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_assets")
    .update({ thumbnail_path: data.thumbnail_path })
    .eq("id", data.asset_id);

  if (error) return { error: error.message };
  revalidatePath("/vault");
  return { error: null };
}

/**
 * Mark a content request as posted on a given platform — without going through
 * the schedule. Used from the Vault when the model posts content manually.
 *
 * Behaviour:
 *  - If a slot already exists for (request_id, platform), update it to posted.
 *  - Otherwise insert a new posted slot dated "now".
 *  - Bump the request status to "posted".
 */
/**
 * Mark one finished cut as posted on one account.
 *
 * The cut is the unit, not the job. A job yields three to five distinct
 * final cuts and each is its own reel that can go out exactly once — so
 * recording this against the request, as it used to, marked all five as
 * posted the moment a VA tagged one of them, and the other four silently
 * left the available pool.
 */
export async function markAssetPostedFromVault(data: {
  asset_id: string;
  request_id: string;
  account_id: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();
  const now = new Date().toISOString();

  // Resolve the account's platform (schedule_slots still stores platform).
  const { data: account } = await supabase
    .from("accounts")
    .select("platform")
    .eq("id", data.account_id)
    .maybeSingle();
  const platform = account?.platform ?? "other";

  // An existing slot for this exact cut on this account
  const { data: existing } = await supabase
    .from("schedule_slots")
    .select("id")
    .eq("persona_id", personaId)
    .eq("asset_id", data.asset_id)
    .eq("account_id", data.account_id)
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("schedule_slots")
      .update({ status: "posted", posted_at: now })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("schedule_slots").insert({
      persona_id: personaId,
      platform,
      account_id: data.account_id,
      scheduled_for: now,
      posted_at: now,
      request_id: data.request_id,
      asset_id: data.asset_id,
      status: "posted",
    });
    if (error) return { error: error.message };
  }

  await syncRequestStatus(supabase, data.request_id);

  revalidatePath("/vault");
  revalidatePath("/editing");
  revalidatePath("/requests");
  return { error: null };
}

/**
 * Toggle the warmup-pool flag on the underlying content request.
 * Lets you move existing content into (or out of) the warmup pool from
 * the Vault.
 */
export async function setRequestWarmup(data: {
  request_id: string;
  is_warmup: boolean;
}) {
  const supabase = await createClient();
  await getPersonaId();
  const { error } = await supabase
    .from("content_requests")
    .update({ is_warmup: data.is_warmup, updated_at: new Date().toISOString() })
    .eq("id", data.request_id);
  if (error) return { error: error.message };
  revalidatePath("/vault");
  revalidatePath("/warmup");
  return { error: null };
}

/**
 * Toggle NSFW classification on the underlying content request.
 * Used from the Vault when the model spots a miscategorised asset.
 */
export async function setRequestNsfw(data: {
  request_id: string;
  is_nsfw: boolean;
}) {
  const supabase = await createClient();
  await getPersonaId(); // ensure session
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("content_requests")
    .update({ is_nsfw: data.is_nsfw, updated_at: now })
    .eq("id", data.request_id);

  if (error) return { error: error.message };

  revalidatePath("/vault");
  revalidatePath("/requests");
  revalidatePath("/schedule");
  return { error: null };
}

/**
 * Undo: remove the "posted" mark for (request_id, account_id).
 */
export async function unmarkAssetPostedFromVault(data: {
  asset_id: string;
  request_id: string;
  account_id: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { data: slot } = await supabase
    .from("schedule_slots")
    .select("id")
    .eq("persona_id", personaId)
    .eq("asset_id", data.asset_id)
    .eq("account_id", data.account_id)
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!slot) return { error: null };

  const { error } = await supabase
    .from("schedule_slots")
    .delete()
    .eq("id", slot.id);

  if (error) return { error: error.message };

  await syncRequestStatus(supabase, data.request_id);

  revalidatePath("/vault");
  revalidatePath("/editing");
  revalidatePath("/requests");
  return { error: null };
}


/**
 * A job counts as posted only once every one of its cuts has gone out.
 *
 * Flipping the job the moment the first cut was posted took the remaining
 * cuts out of "ready to post" while they were still unused — which made the
 * model's buffer look emptier than it was and hid finished work from the
 * people meant to post it.
 */
async function syncRequestStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestId: string
) {
  const { data: cuts } = await supabase
    .from("content_assets")
    .select("id")
    .eq("request_id", requestId)
    .eq("stage", "edited");
  const cutIds = (cuts ?? []).map((c) => c.id);
  if (cutIds.length === 0) return;

  const { data: posted } = await supabase
    .from("schedule_slots")
    .select("asset_id")
    .eq("status", "posted")
    .in("asset_id", cutIds);
  const postedCuts = new Set(
    (posted ?? []).map((p) => p.asset_id).filter(Boolean)
  );

  await supabase
    .from("content_requests")
    .update({
      status: postedCuts.size >= cutIds.length ? "posted" : "edited",
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
}
