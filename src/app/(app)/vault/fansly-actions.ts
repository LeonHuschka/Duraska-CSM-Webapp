"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActivePersonaId } from "@/lib/persona";
import { deleteMessage } from "@/lib/telegram";
import { atTime, hhmm } from "@/components/planner/planner-utils";
import {
  FANSLY_TZ,
  captionFor,
  cleanSlots,
  deliver,
  fillDrafts,
  readSchedule,
  withHashtags,
} from "@/lib/fansly-plan";

/**
 * The Fansly calendar's actions. Owners and managers only: they set the
 * times, approve and move posts; the app fills the free times as drafts,
 * and the cron sends approved posts to the VA the day before.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;
type Result = { error: string | null };

async function staff(supabase: Sb, personaId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const ok = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  return ok ? user.id : null;
}

async function ctx() {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const userId = await staff(supabase, personaId);
  return { supabase, personaId, userId };
}

const done = (error?: { message: string } | null): Result => {
  revalidatePath("/vault");
  return { error: error?.message ?? null };
};

const DENIED = { error: "Only owners and managers" };

/** A post planned by hand: approved as it is, sent the day before. */
export async function planFanslyPost(input: {
  assetId: string;
  when: string;
  caption: string;
  price: number | null;
  note: string;
}): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const when = new Date(input.when);
  if (Number.isNaN(when.getTime())) return { error: "Pick a date and time" };
  if (when.getTime() < Date.now() - 60_000) return { error: "That time has passed" };
  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, content_requests!inner(persona_id)")
    .eq("id", input.assetId)
    .is("deleted_at", null)
    .maybeSingle();
  const req = asset?.content_requests as unknown as { persona_id: string } | null;
  if (!asset || req?.persona_id !== personaId) return { error: "Cut not found" };
  const { error } = await supabase.from("fansly_posts").insert({
    persona_id: personaId,
    asset_id: asset.id,
    scheduled_for: when.toISOString(),
    caption: input.caption.trim().slice(0, 3000),
    caption_source: "manual",
    price: input.price != null && input.price > 0 ? Math.round(input.price * 100) / 100 : null,
    note: input.note.trim().slice(0, 500) || null,
    status: "approved",
    fyp: true,
    created_by: userId,
  });
  return done(error);
}

/** Change a post: time, caption, price, note — and approve it in one go. */
export async function updateFanslyPost(
  id: string,
  input: { when: string; caption: string; price: number | null; note: string; approve: boolean }
): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const when = new Date(input.when);
  if (Number.isNaN(when.getTime())) return { error: "Pick a date and time" };
  const { data: post } = await supabase
    .from("fansly_posts")
    .select("status, caption")
    .eq("id", id)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!post) return { error: "Not found" };
  const caption = input.caption.trim().slice(0, 3000);
  const { error } = await supabase
    .from("fansly_posts")
    .update({
      scheduled_for: when.toISOString(),
      caption,
      ...(caption === post.caption ? {} : { caption_source: "manual" }),
      price: input.price != null && input.price > 0 ? Math.round(input.price * 100) / 100 : null,
      note: input.note.trim().slice(0, 500) || null,
      // A sent post stays sent; send it again to pass the change on.
      ...(post.status === "sent" || post.status === "sending" ? {} : { status: input.approve ? "approved" : "draft" }),
    })
    .eq("id", id);
  return done(error);
}

/** Approve, or take approval back from, posts not sent yet. */
export async function setFanslyApproved(ids: string[], on: boolean): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  if (!ids.length) return { error: null };
  const { error } = await supabase
    .from("fansly_posts")
    .update({ status: on ? "approved" : "draft" })
    .eq("persona_id", personaId)
    .in("id", ids)
    .in("status", on ? ["draft", "failed"] : ["approved"]);
  return done(error);
}

/**
 * A post dragged to another time. When another post not sent yet holds
 * that time, the two trade places.
 */
export async function moveFanslyPost(id: string, day: string, time: string): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const target = atTime(day, time, FANSLY_TZ);
  if (Number.isNaN(target.getTime())) return { error: "Unknown time" };
  const [{ data: moving }, { data: posts }] = await Promise.all([
    supabase.from("fansly_posts").select("scheduled_for, status").eq("id", id).eq("persona_id", personaId).maybeSingle(),
    supabase
      .from("fansly_posts")
      .select("id, scheduled_for, status")
      .eq("persona_id", personaId)
      .gte("scheduled_for", atTime(day, "00:00", FANSLY_TZ).toISOString())
      .lte("scheduled_for", atTime(day, "23:59", FANSLY_TZ).toISOString()),
  ]);
  if (!moving) return { error: "Not found" };
  if (moving.status === "sent" || moving.status === "sending") return { error: "Already with the VA — take it back to move it" };
  const other = (posts ?? []).find((p) => p.id !== id && hhmm(new Date(p.scheduled_for), FANSLY_TZ) === time);
  if (other && (other.status === "sent" || other.status === "sending")) return { error: "That time holds a post the VA already has" };
  if (other) {
    const { error } = await supabase.from("fansly_posts").update({ scheduled_for: moving.scheduled_for }).eq("id", other.id);
    if (error) return done(error);
  }
  const { error } = await supabase.from("fansly_posts").update({ scheduled_for: target.toISOString() }).eq("id", id);
  return done(error);
}

/** A new caption from the cut's picture. */
export async function regenerateFanslyCaption(id: string): Promise<{ error: string | null; caption?: string }> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const { data: post } = await supabase
    .from("fansly_posts")
    .select("asset_id")
    .eq("id", id)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!post) return { error: "Not found" };
  const admin = createAdminClient();
  const [{ data: asset }, schedule, { data: past }] = await Promise.all([
    admin.from("content_assets").select("thumbnail_path").eq("id", post.asset_id).maybeSingle(),
    readSchedule(admin, personaId),
    admin
      .from("fansly_posts")
      .select("caption, caption_source")
      .eq("persona_id", personaId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const examples = (past ?? [])
    .filter((p) => p.caption_source !== "emoji")
    .map((p) => p.caption.replace(/#[^\s#]+/g, "").trim())
    .filter((l) => l.length > 8);
  const c = await captionFor(admin, asset?.thumbnail_path ?? null, examples);
  const caption = withHashtags(c.text, schedule.hashtags);
  const { error } = await supabase.from("fansly_posts").update({ caption, caption_source: c.source }).eq("id", id);
  done(error);
  return { error: error?.message ?? null, caption };
}

/** Fill the free times of the next two weeks now, instead of waiting for the morning. */
export async function fillFanslyNow(): Promise<{ error: string | null; created?: number; short?: number }> {
  const { personaId, userId } = await ctx();
  if (!userId) return DENIED;
  try {
    const r = await fillDrafts(createAdminClient(), personaId);
    revalidatePath("/vault");
    return { error: null, ...r };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not fill" };
  }
}

/** The usual times of a day (LA), as many as posts a day. */
export async function saveFanslySlots(slots: string[]): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const clean = cleanSlots(slots);
  if (!clean.length) return { error: "Keep at least one time" };
  const schedule = await readSchedule(createAdminClient(), personaId);
  const { error } = await supabase.from("fansly_schedule").upsert({
    persona_id: personaId,
    slots: clean,
    overrides: schedule.overrides,
    hashtags: schedule.hashtags,
    updated_at: new Date().toISOString(),
  });
  return done(error);
}

/** One day's own times; null goes back to the usual ones. */
export async function setFanslyDaySlots(day: string, slots: string[] | null): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Unknown day" };
  const schedule = await readSchedule(createAdminClient(), personaId);
  const overrides = { ...schedule.overrides };
  if (slots === null) delete overrides[day];
  else overrides[day] = cleanSlots(slots);
  const { error } = await supabase.from("fansly_schedule").upsert({
    persona_id: personaId,
    slots: schedule.slots,
    overrides,
    hashtags: schedule.hashtags,
    updated_at: new Date().toISOString(),
  });
  return done(error);
}

/** The hashtags every caption ends with. */
export async function saveFanslyHashtags(hashtags: string): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const tags = Array.from(new Set(hashtags.match(/#[^\s#]+/g) ?? [])).join(" ");
  const schedule = await readSchedule(createAdminClient(), personaId);
  const { error } = await supabase.from("fansly_schedule").upsert({
    persona_id: personaId,
    slots: schedule.slots,
    overrides: schedule.overrides,
    hashtags: tags,
    updated_at: new Date().toISOString(),
  });
  return done(error);
}

/** Sends a post to the VA again, as it stands now, in place of its old task. */
export async function resendFanslyPost(id: string): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const { data: row } = await supabase
    .from("fansly_posts")
    .select("message_id")
    .eq("id", id)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!row) return { error: "Not found" };
  if (row.message_id) await dropMessage(personaId, Number(row.message_id));
  const error = await deliver(id);
  revalidatePath("/vault");
  return { error };
}

/** Takes a plan back, and the task out of the VA's topic. */
export async function removeFanslyPost(id: string): Promise<Result> {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return DENIED;
  const { data: row } = await supabase
    .from("fansly_posts")
    .select("message_id")
    .eq("id", id)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!row) return { error: "Not found" };
  if (row.message_id) await dropMessage(personaId, Number(row.message_id));
  const { error } = await supabase.from("fansly_posts").delete().eq("id", id).eq("persona_id", personaId);
  return done(error);
}

async function dropMessage(personaId: string, messageId: number) {
  const { data: cfg } = await createAdminClient()
    .from("telegram_config")
    .select("chat_id")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (cfg?.chat_id) await deleteMessage({ chat_id: cfg.chat_id, message_id: messageId });
}
