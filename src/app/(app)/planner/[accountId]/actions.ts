"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plannerAccount } from "@/lib/planner-access";
import { publishDue } from "@/lib/auto-publish";
import { connectWithToken } from "@/lib/instagram-api";

type Res = { error: string | null; id?: string };

const MAX_CAPTION = 2200;
const MAX_TAGS = 30;

function checkCaption(caption: string): string | null {
  if (caption.length > MAX_CAPTION) return `The caption is ${caption.length} characters — Instagram takes ${MAX_CAPTION}`;
  const tags = caption.match(/#[^\s#]+/g)?.length ?? 0;
  if (tags > MAX_TAGS) return `${tags} hashtags — Instagram takes ${MAX_TAGS}`;
  return null;
}

/** The slot, if it is an auto-post the signed-in user may plan for. */
async function ownSlot(slotId: string) {
  const supabase = await createClient();
  const { data: slot } = await supabase.from("schedule_slots").select("*").eq("id", slotId).maybeSingle();
  if (!slot?.account_id || !slot.auto_publish) return null;
  const access = await plannerAccount(slot.account_id);
  return access ? { slot, supabase } : null;
}

/** Still ours to change: not on its way to Instagram and not out yet. */
function editable(state: string | null, status: string) {
  return status === "scheduled" && state !== "uploading" && state !== "publishing" && state !== "published";
}

export async function schedulePost(data: {
  accountId: string;
  assetId: string;
  scheduledFor: string;
  caption: string;
  trialReel: boolean;
  shareToFeed: boolean;
}): Promise<Res> {
  const access = await plannerAccount(data.accountId);
  if (!access) return { error: "Not allowed" };
  const bad = checkCaption(data.caption);
  if (bad) return { error: bad };
  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, request_id")
    .eq("id", data.assetId)
    .is("deleted_at", null)
    .maybeSingle();
  const { data: request } = asset
    ? await supabase.from("content_requests").select("persona_id").eq("id", asset.request_id).maybeSingle()
    : { data: null };
  if (!asset || request?.persona_id !== access.account.persona_id) return { error: "No such cut" };
  const { data: slot, error } = await supabase
    .from("schedule_slots")
    .insert({
      persona_id: access.account.persona_id,
      account_id: data.accountId,
      request_id: asset.request_id,
      asset_id: asset.id,
      platform: "instagram",
      scheduled_for: data.scheduledFor,
      caption: data.caption.trim() || null,
      status: "scheduled",
      auto_publish: true,
      trial_reel: data.trialReel,
      share_to_feed: data.shareToFeed,
      created_by: access.userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath(`/planner/${data.accountId}`);
  return { error: null, id: slot.id };
}

export async function updatePost(
  slotId: string,
  patch: { scheduledFor?: string; caption?: string; trialReel?: boolean; shareToFeed?: boolean }
): Promise<Res> {
  const own = await ownSlot(slotId);
  if (!own) return { error: "Not allowed" };
  if (!editable(own.slot.publish_state, own.slot.status)) return { error: "It is already on its way to Instagram" };
  if (patch.caption !== undefined) {
    const bad = checkCaption(patch.caption);
    if (bad) return { error: bad };
  }
  const { error } = await own.supabase
    .from("schedule_slots")
    .update({
      ...(patch.scheduledFor ? { scheduled_for: patch.scheduledFor } : {}),
      ...(patch.caption !== undefined ? { caption: patch.caption.trim() || null } : {}),
      ...(patch.trialReel !== undefined ? { trial_reel: patch.trialReel } : {}),
      ...(patch.shareToFeed !== undefined ? { share_to_feed: patch.shareToFeed } : {}),
      // Changing a failed post is the fix: it goes back in the queue.
      ...(own.slot.publish_state === "failed"
        ? { publish_state: null, publish_error: null, publish_attempts: 0, ig_container_id: null }
        : {}),
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  revalidatePath(`/planner/${own.slot.account_id}`);
  return { error: null };
}

export async function deletePost(slotId: string): Promise<Res> {
  const own = await ownSlot(slotId);
  if (!own) return { error: "Not allowed" };
  if (!editable(own.slot.publish_state, own.slot.status)) return { error: "It is already on its way to Instagram" };
  const { error } = await own.supabase.from("schedule_slots").delete().eq("id", slotId);
  if (error) return { error: error.message };
  revalidatePath(`/planner/${own.slot.account_id}`);
  return { error: null };
}

/** Out now: the time moves to now and the publisher runs for this one post. */
export async function postNow(slotId: string): Promise<Res & { state?: string }> {
  const own = await ownSlot(slotId);
  if (!own) return { error: "Not allowed" };
  if (!editable(own.slot.publish_state, own.slot.status)) return { error: "It is already on its way to Instagram" };
  const { error } = await own.supabase
    .from("schedule_slots")
    .update({
      scheduled_for: new Date().toISOString(),
      publish_state: null,
      publish_error: null,
      publish_attempts: 0,
      ig_container_id: null,
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  const [result] = await publishDue(createAdminClient(), { slotId, deadline: Date.now() + 250_000 });
  revalidatePath(`/planner/${own.slot.account_id}`);
  if (!result) return { error: "Nothing to publish" };
  if (result.state === "failed" || result.state === "retry") return { error: result.note ?? "Failed", state: result.state };
  if (result.state === "waiting") return { error: "Connect Instagram first", state: result.state };
  return { error: null, state: result.state };
}

/** A token pasted from the Meta dashboard; kept only if it reaches this very account. */
export async function connectInstagram(accountId: string, token: string): Promise<Res & { username?: string }> {
  const access = await plannerAccount(accountId);
  if (!access) return { error: "Not allowed" };
  if (!token.trim()) return { error: "Paste the token first" };
  try {
    const conn = await connectWithToken(token, access.account.handle ?? "");
    const { error } = await createAdminClient()
      .from("ig_connections")
      .upsert({
        account_id: accountId,
        persona_id: access.account.persona_id,
        ig_user_id: conn.igUserId,
        username: conn.username,
        access_token: conn.token,
        token_expires_at: conn.expiresAt,
        connected_by: access.userId,
        connected_at: new Date().toISOString(),
        refreshed_at: null,
      });
    if (error) return { error: error.message };
    revalidatePath(`/planner/${accountId}`);
    return { error: null, username: conn.username };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not connect" };
  }
}

export async function disconnectInstagram(accountId: string): Promise<Res> {
  const access = await plannerAccount(accountId);
  if (!access) return { error: "Not allowed" };
  const { error } = await createAdminClient().from("ig_connections").delete().eq("account_id", accountId);
  if (error) return { error: error.message };
  revalidatePath(`/planner/${accountId}`);
  return { error: null };
}
