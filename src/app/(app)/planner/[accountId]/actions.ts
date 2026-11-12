"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plannerAccount } from "@/lib/planner-access";
import { publishDue } from "@/lib/auto-publish";
import { connectWithToken } from "@/lib/instagram-api";
import { isVideoPath } from "@/lib/feed-media";
import { TIMEZONES } from "@/components/planner/planner-utils";

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

/** A reel from the vault (assetId), or a feed post of pictures uploaded in the planner. */
export async function schedulePost(data: {
  accountId: string;
  assetId?: string;
  feedPaths?: string[];
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
  const personaId = access.account.persona_id;
  const base = {
    persona_id: personaId,
    account_id: data.accountId,
    platform: "instagram" as const,
    scheduled_for: data.scheduledFor,
    caption: data.caption.trim() || null,
    status: "scheduled",
    auto_publish: true,
    created_by: access.userId,
  };

  let row;
  if (data.feedPaths) {
    const paths = data.feedPaths;
    if (paths.length < 1 || paths.length > 10) return { error: "A feed post has 1 to 10 pictures or videos" };
    if (!paths.every((p) => p.startsWith(`personas/${personaId}/feed/`))) return { error: "Not this persona's pictures" };
    if (paths.length === 1 && isVideoPath(paths[0])) return { error: "One video alone goes out as a reel — add a picture for a carousel" };
    row = {
      ...base,
      media_kind: paths.length === 1 ? "image" : "carousel",
      media_paths: paths,
      trial_reel: false,
      share_to_feed: true,
    };
  } else {
    const asset = await ownAsset(personaId, data.assetId ?? "");
    if (!asset) return { error: "No such cut" };
    row = {
      ...base,
      request_id: asset.request_id,
      asset_id: asset.id,
      trial_reel: data.trialReel,
      share_to_feed: data.shareToFeed,
    };
  }
  const { data: slot, error } = await supabase.from("schedule_slots").insert(row).select("id").single();
  if (error) return { error: error.message };
  revalidatePath(`/planner/${data.accountId}`);
  return { error: null, id: slot.id };
}

async function ownAsset(personaId: string, assetId: string) {
  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, request_id")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset) return null;
  const { data: request } = await supabase.from("content_requests").select("persona_id").eq("id", asset.request_id).maybeSingle();
  return request?.persona_id === personaId ? asset : null;
}

/** Several reels at once — the planner's "Fill free times". */
export async function fillSlots(
  accountId: string,
  items: { assetId: string; at: string }[],
  caption: string
): Promise<Res & { count?: number }> {
  const access = await plannerAccount(accountId);
  if (!access) return { error: "Not allowed" };
  if (!items.length) return { error: "Nothing to plan" };
  if (items.length > 60) return { error: "Too many at once" };
  const bad = checkCaption(caption);
  if (bad) return { error: bad };
  const rows = [];
  for (const it of items) {
    if (new Date(it.at).getTime() < Date.now()) return { error: "One of the times has passed — open the planner again" };
    const asset = await ownAsset(access.account.persona_id, it.assetId);
    if (!asset) return { error: "One of the cuts is gone — open the planner again" };
    rows.push({
      persona_id: access.account.persona_id,
      account_id: accountId,
      request_id: asset.request_id,
      asset_id: asset.id,
      platform: "instagram" as const,
      scheduled_for: it.at,
      caption: caption.trim() || null,
      status: "scheduled",
      auto_publish: true,
      created_by: access.userId,
    });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("schedule_slots").insert(rows);
  if (error) return { error: error.message };
  revalidatePath(`/planner/${accountId}`);
  return { error: null, count: rows.length };
}

/** The account's planning clock and pace. */
export async function setPlannerSettings(
  accountId: string,
  patch: { timezone?: string; perDay?: number }
): Promise<Res> {
  const access = await plannerAccount(accountId);
  if (!access) return { error: "Not allowed" };
  const update: { post_timezone?: string; posts_per_day?: number } = {};
  if (patch.timezone !== undefined) {
    if (!TIMEZONES.some((t) => t.id === patch.timezone)) return { error: "Unknown time zone" };
    update.post_timezone = patch.timezone;
  }
  if (patch.perDay !== undefined) {
    if (!Number.isInteger(patch.perDay) || patch.perDay < 0 || patch.perDay > 6) return { error: "0 to 6 a day" };
    update.posts_per_day = patch.perDay;
  }
  const { error } = await createAdminClient().from("accounts").update(update).eq("id", accountId);
  if (error) return { error: error.message };
  revalidatePath(`/planner/${accountId}`);
  return { error: null };
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
export async function connectInstagram(accountId: string, token: string, igAccountId?: string): Promise<Res & { username?: string }> {
  const access = await plannerAccount(accountId);
  if (!access) return { error: "Not allowed" };
  if (!token.trim()) return { error: "Paste the token first" };
  try {
    const conn = await connectWithToken(token, access.account.handle ?? "", igAccountId);
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
    const msg = err instanceof Error ? err.message : "Could not connect";
    console.error(`[ig-connect] ${access.account.handle}: ${msg} (token ${token.trim().slice(0, 4)}…)`);
    return { error: msg };
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
