import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { editMessageText, sendMessage } from "@/lib/telegram";

/**
 * "New content shot" — one line in TALK for the VA, so she knows there is
 * something to cut without opening the app.
 *
 * A shoot is many uploads over an hour or two, so this is one message per
 * session, not one per take: the first take posts it, every further take
 * edits the number in place. A new message starts only after an hour with
 * nothing uploaded — the date does not matter, a session that runs past
 * midnight is still one session.
 */
const SESSION_GAP_MS = 60 * 60 * 1000;

export async function announceShoot(requestId: string) {
  try {
    const supabase = createAdminClient();
    const { data: req } = await supabase
      .from("content_requests")
      .select("persona_id")
      .eq("id", requestId)
      .maybeSingle();
    if (!req?.persona_id) return;

    const { data: cfg } = await supabase
      .from("telegram_config")
      .select(
        "chat_id, talk_thread_id, model_username, va_username, shoot_notice_message_id, shoot_notice_started_at, shoot_notice_last_at"
      )
      .eq("persona_id", req.persona_id)
      .maybeSingle();
    if (!cfg?.chat_id) return;

    const now = Date.now();
    const last = cfg.shoot_notice_last_at ? new Date(cfg.shoot_notice_last_at).getTime() : 0;
    const continuing = cfg.shoot_notice_message_id != null && now - last < SESSION_GAP_MS;

    // Takes land three at a time, so the count is read from the table
    // rather than kept in a counter that two uploads would both bump.
    const startedAt = continuing && cfg.shoot_notice_started_at
      ? cfg.shoot_notice_started_at
      : new Date(now - 60_000).toISOString();
    const count = await countTakes(supabase, req.persona_id, startedAt);
    const text = notice(cfg.model_username, cfg.va_username, count);
    if (count.files === 0) return;

    if (continuing) {
      await editMessageText({
        chat_id: cfg.chat_id,
        message_id: Number(cfg.shoot_notice_message_id),
        text,
      });
      await supabase
        .from("telegram_config")
        .update({ shoot_notice_last_at: new Date(now).toISOString() })
        .eq("persona_id", req.persona_id);
      return;
    }

    // Claim the new session before sending, so a second take arriving in
    // the same second edits this message instead of posting its own.
    const { data: claimed } = await supabase
      .from("telegram_config")
      .update({
        shoot_notice_started_at: startedAt,
        shoot_notice_last_at: new Date(now).toISOString(),
        shoot_notice_message_id: null,
      })
      .eq("persona_id", req.persona_id)
      .or(
        `shoot_notice_last_at.is.null,shoot_notice_last_at.lt.${new Date(now - SESSION_GAP_MS).toISOString()}`
      )
      .select("persona_id");
    if (!claimed || claimed.length === 0) {
      // Somebody else just opened the session; give their message a moment
      // to exist, then fall through to the edit path.
      await new Promise((r) => setTimeout(r, 1500));
      return announceShoot(requestId);
    }

    const res = await sendMessage({
      chat_id: cfg.chat_id,
      message_thread_id: cfg.talk_thread_id,
      text,
    });
    const messageId = (res.result as { message_id?: number } | undefined)?.message_id;
    if (res.ok && messageId) {
      await supabase
        .from("telegram_config")
        .update({ shoot_notice_message_id: messageId })
        .eq("persona_id", req.persona_id);
    }
  } catch (err) {
    console.warn("[shoot-notice] failed", err);
  }
}

async function countTakes(
  supabase: ReturnType<typeof createAdminClient>,
  personaId: string,
  since: string
): Promise<{ files: number; reels: number }> {
  const { data: reqs } = await supabase
    .from("content_requests")
    .select("id")
    .eq("persona_id", personaId);
  const ids = (reqs ?? []).map((r) => r.id);
  if (ids.length === 0) return { files: 0, reels: 0 };
  const { data } = await supabase
    .from("content_assets")
    .select("request_id")
    .in("request_id", ids)
    .eq("stage", "raw")
    .is("deleted_at", null)
    .gte("uploaded_at", since);
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
