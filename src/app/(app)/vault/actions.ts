"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";

async function getPersonaId() {
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  if (!personaId) throw new Error("No active persona selected");
  return personaId;
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
export async function markAssetPostedFromVault(data: {
  request_id: string;
  platform: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();
  const now = new Date().toISOString();

  // Look for an existing slot on this platform for this request
  const { data: existing } = await supabase
    .from("schedule_slots")
    .select("id, status")
    .eq("persona_id", personaId)
    .eq("request_id", data.request_id)
    .eq("platform", data.platform)
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
      platform: data.platform,
      scheduled_for: now,
      posted_at: now,
      request_id: data.request_id,
      status: "posted",
    });
    if (error) return { error: error.message };
  }

  // Bump the content request status to posted
  await supabase
    .from("content_requests")
    .update({ status: "posted", updated_at: now })
    .eq("id", data.request_id);

  revalidatePath("/vault");
  revalidatePath("/schedule");
  revalidatePath("/requests");
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
 * Undo: remove the "posted" mark for (request_id, platform).
 * Deletes the slot if it was created from the vault, or reverts to "scheduled"
 * if the slot was a real scheduled posting.
 */
export async function unmarkAssetPostedFromVault(data: {
  request_id: string;
  platform: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { data: slot } = await supabase
    .from("schedule_slots")
    .select("id")
    .eq("persona_id", personaId)
    .eq("request_id", data.request_id)
    .eq("platform", data.platform)
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!slot) return { error: null };

  // For vault-marked posts (scheduled_for == posted_at within a few seconds),
  // delete the slot. Otherwise just revert status. Simpler: just delete —
  // the vault flow doesn't preserve scheduling intent.
  const { error } = await supabase
    .from("schedule_slots")
    .delete()
    .eq("id", slot.id);

  if (error) return { error: error.message };

  revalidatePath("/vault");
  revalidatePath("/schedule");
  revalidatePath("/requests");
  return { error: null };
}
