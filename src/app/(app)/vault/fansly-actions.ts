"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActivePersonaId } from "@/lib/persona";
import { deleteMessage, sendMessage, sendVideo } from "@/lib/telegram";

/**
 * The Fansly planner. A Fansly cut, planned for a time with its caption,
 * goes to the VA's Fansly topic at once as a task: the video, when to put
 * it up, the price and the caption to copy. The VA sets it in Fansly's own
 * scheduler. Owners and managers only.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Telegram takes up to 50 MB from a bot; a bigger cut goes as a link. */
const MAX_VIDEO_BYTES = 49 * 1024 * 1024;
const MAX_CAPTION = 1024;

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

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function berlinTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export async function planFanslyPost(input: {
  assetId: string;
  when: string;
  caption: string;
  price: number | null;
  note: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const userId = await staff(supabase, personaId);
  if (!userId) return { error: "Only owners and managers" };

  const when = new Date(input.when);
  if (Number.isNaN(when.getTime())) return { error: "Pick a date and time" };
  if (when.getTime() < Date.now() - 60_000) return { error: "That time has passed" };
  const caption = input.caption.trim().slice(0, 3000);
  const note = input.note.trim().slice(0, 500);
  const price = input.price != null && input.price > 0 ? Math.round(input.price * 100) / 100 : null;

  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, file_path, file_name, size_bytes, stage, content_requests!inner(persona_id, title)")
    .eq("id", input.assetId)
    .is("deleted_at", null)
    .maybeSingle();
  const req = asset?.content_requests as unknown as { persona_id: string; title: string | null } | null;
  if (!asset || req?.persona_id !== personaId) return { error: "Cut not found" };

  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("telegram_config")
    .select("chat_id, fansly_thread_id, va_username")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!cfg?.chat_id || !cfg.fansly_thread_id) return { error: "No Fansly topic set for this model" };

  const { data: row, error: insErr } = await supabase
    .from("fansly_posts")
    .insert({
      persona_id: personaId,
      asset_id: asset.id,
      scheduled_for: when.toISOString(),
      caption,
      price,
      note: note || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (insErr || !row) return { error: insErr?.message ?? "Could not save" };

  // The task: when, price, note, then the caption to copy.
  const head = [
    `📅 <b>Fansly post — schedule for ${esc(berlinTime(when.toISOString()))} (Berlin)</b>`,
    cfg.va_username ? `@${esc(cfg.va_username.replace(/^@/, ""))}` : null,
    price ? `💰 PPV $${price.toFixed(2)}` : "🆓 Free post",
    note ? `📝 ${esc(note)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const body = caption ? `\n\n<b>Caption</b> (tap to copy):\n<pre>${esc(caption)}</pre>` : "\n\n<i>No caption</i>";
  const together = head + body;
  const fits = together.length <= MAX_CAPTION;

  let messageId: number | null = null;
  let error: string | null = null;
  const thread = { chat_id: cfg.chat_id, message_thread_id: cfg.fansly_thread_id };

  if ((asset.size_bytes ?? 0) <= MAX_VIDEO_BYTES) {
    const { data: file } = await supabase.storage.from("content-assets").download(asset.file_path);
    if (file) {
      const sent = await sendVideo({
        ...thread,
        video: new Uint8Array(await file.arrayBuffer()),
        filename: asset.file_name.replace(/\.[^.]+$/, "") + ".mp4",
        caption: fits ? together : head,
        parse_mode: "HTML",
      });
      if (sent.ok) messageId = sent.result?.message_id ?? null;
      else error = sent.error ?? "Video not sent";
    } else error = "Video could not be read";
  }
  if (messageId == null) {
    // Too big for a bot, or the upload failed: the task with a download link.
    const { data: signed } = await supabase.storage.from("content-assets").createSignedUrl(asset.file_path, 7 * 24 * 3600);
    const sent = await sendMessage({
      ...thread,
      text: together + (signed?.signedUrl ? `\n\n<a href="${esc(signed.signedUrl)}">⬇️ Download the video</a>` : ""),
      parse_mode: "HTML",
    });
    if (sent.ok) {
      messageId = sent.result?.message_id ?? null;
      error = null;
    } else error = sent.error ?? error ?? "Not sent";
  } else if (!fits) {
    // The caption did not fit under the video: it follows as a reply.
    await sendMessage({ ...thread, text: body.trim(), parse_mode: "HTML", reply_to_message_id: messageId });
  }

  await supabase
    .from("fansly_posts")
    .update({ status: messageId != null ? "sent" : "failed", message_id: messageId, error })
    .eq("id", row.id);
  revalidatePath("/vault");
  return { error: messageId != null ? null : `Saved, but not sent to the VA: ${error}` };
}

/** Takes a plan back, and the task out of the VA's topic. */
export async function removeFanslyPost(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  if (!(await staff(supabase, personaId))) return { error: "Only owners and managers" };
  const { data: row } = await supabase
    .from("fansly_posts")
    .select("message_id")
    .eq("id", id)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!row) return { error: "Not found" };
  if (row.message_id) {
    const { data: cfg } = await createAdminClient()
      .from("telegram_config")
      .select("chat_id")
      .eq("persona_id", personaId)
      .maybeSingle();
    if (cfg?.chat_id) await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(row.message_id) });
  }
  const { error } = await supabase.from("fansly_posts").delete().eq("id", id).eq("persona_id", personaId);
  revalidatePath("/vault");
  return { error: error?.message ?? null };
}
