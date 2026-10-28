import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { berlinDay } from "@/lib/berlin-day";
import { editMessageText, sendMessage } from "@/lib/telegram";

/**
 * "New content shot" — one line in TALK for the VA, so she knows there is
 * something to cut without opening the app.
 *
 * Only jobs the model sends from the upload tab count: a take added to an
 * older job, or by the team, is not a new shoot. One message per Berlin
 * day — the first upload posts it, every later one that day edits the
 * numbers in place.
 */
export async function announceShoot(personaId: string) {
  try {
    const supabase = createAdminClient();
    const { data: cfg } = await supabase
      .from("telegram_config")
      .select("chat_id, talk_thread_id, model_username, va_username, shoot_notice_message_id, shoot_notice_started_at")
      .eq("persona_id", personaId)
      .maybeSingle();
    if (!cfg?.chat_id) return;

    const today = berlinDay(new Date());
    const count = await countToday(supabase, personaId, today);
    if (count.files === 0) return;
    const text = notice(cfg.model_username, cfg.va_username, count);

    const todays =
      cfg.shoot_notice_message_id != null &&
      cfg.shoot_notice_started_at != null &&
      berlinDay(cfg.shoot_notice_started_at) === today;
    if (todays) {
      const res = await editMessageText({
        chat_id: cfg.chat_id,
        message_id: Number(cfg.shoot_notice_message_id),
        text,
      });
      // Gone (deleted by hand) is the only reason to post a fresh one.
      if (res.ok || !/not found|to edit/i.test(res.error ?? "")) return;
    }

    const res = await sendMessage({
      chat_id: cfg.chat_id,
      message_thread_id: cfg.talk_thread_id,
      text,
    });
    const messageId = (res.result as { message_id?: number } | undefined)?.message_id;
    if (res.ok && messageId) {
      const now = new Date().toISOString();
      await supabase
        .from("telegram_config")
        .update({ shoot_notice_message_id: messageId, shoot_notice_started_at: now, shoot_notice_last_at: now })
        .eq("persona_id", personaId);
    }
  } catch (err) {
    console.warn("[shoot-notice] failed", err);
  }
}

/** Upload-tab jobs made today (they are the only shooted, non-trial jobs born that day) and their takes. */
async function countToday(
  supabase: ReturnType<typeof createAdminClient>,
  personaId: string,
  today: string
): Promise<{ files: number; reels: number }> {
  const { data: reqs } = await supabase
    .from("content_requests")
    .select("id, created_at")
    .eq("persona_id", personaId)
    .eq("is_trial", false)
    .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString());
  const ids = (reqs ?? []).filter((r) => berlinDay(r.created_at) === today).map((r) => r.id);
  if (ids.length === 0) return { files: 0, reels: 0 };
  const { data } = await supabase
    .from("content_assets")
    .select("request_id")
    .in("request_id", ids)
    .eq("stage", "raw")
    .is("deleted_at", null);
  const rows = data ?? [];
  return { files: rows.length, reels: new Set(rows.map((r) => r.request_id)).size };
}

/** "2 reels · 5 video files" — a reel is a job, a file is one take of it. */
function notice(
  model: string | null,
  va: string | null,
  count: { files: number; reels: number }
): string {
  const at = (u: string | null) => (u ? `@${u.replace(/^@/, "")}` : null);
  const who = at(model) ?? "the model";
  const reels = Math.max(1, count.reels);
  const files = Math.max(1, count.files);
  return (
    `🎬 ${at(va) ?? "fyi"} — ${who} shot new content: ` +
    `${reels} ${reels === 1 ? "reel" : "reels"} · ${files} video ${files === 1 ? "file" : "files"} ✨ ` +
    `ready for cutting whenever you are`
  );
}
