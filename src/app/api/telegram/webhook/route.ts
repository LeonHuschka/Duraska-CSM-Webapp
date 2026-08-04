import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractInstagramLinks,
  instagramKey,
  sendMessage,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Telegram webhook.
 *
 * Handles two things:
 *  1. A message containing Instagram links in the "content requests" topic
 *     → recorded as open inspo links.
 *  2. A reaction by the model on such a message → that link counts as shot.
 *
 * Telegram cannot show a bot anything that happened before it joined the
 * group, so only messages from now on are captured. Anything older has to
 * be re-posted (or seeded manually) if it should show up in the backlog.
 */

// Only look at messages from this date onward, per the brief.
const IGNORE_BEFORE = new Date("2026-05-30T00:00:00Z");

type TgUser = { id: number; username?: string; first_name?: string };
type TgChat = { id: number; title?: string; type: string };
type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
};
type TgReactionUpdate = {
  chat: TgChat;
  message_id: number;
  user?: TgUser;
  date: number;
  new_reaction: { type: string; emoji?: string }[];
};

export async function POST(req: Request) {
  // Telegram echoes back the secret we set with setWebhook — reject anything
  // that can't prove it came from Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: {
    message?: TgMessage;
    edited_message?: TgMessage;
    message_reaction?: TgReactionUpdate;
  };
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.message) await handleMessage(update.message);
    else if (update.message_reaction) await handleReaction(update.message_reaction);
  } catch (err) {
    // Always 200 — a non-2xx makes Telegram retry the same update forever.
    console.error("[telegram] handler failed", err);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: TgMessage) {
  const text = msg.text ?? msg.caption ?? "";
  if (!text) return;

  const supabase = createAdminClient();

  // `/id` in any chat replies with the ids needed for configuration —
  // saves hunting for chat/topic ids by hand.
  if (text.trim().startsWith("/id")) {
    await sendMessage({
      chat_id: msg.chat.id,
      message_thread_id: msg.message_thread_id ?? null,
      text:
        `<b>Chat ID:</b> <code>${msg.chat.id}</code>\n` +
        `<b>Topic ID:</b> <code>${msg.message_thread_id ?? "— (General)"}</code>\n\n` +
        `Put these into Settings → Telegram.`,
    });
    return;
  }

  const links = extractInstagramLinks(text);
  if (links.length === 0) return;

  const postedAt = new Date(msg.date * 1000);
  if (postedAt < IGNORE_BEFORE) return;

  // Which persona does this chat belong to, and is this the requests topic?
  const { data: config } = await supabase
    .from("telegram_config")
    .select("persona_id, requests_thread_id")
    .eq("chat_id", msg.chat.id)
    .maybeSingle();
  if (!config) return; // chat not wired up yet

  if (
    config.requests_thread_id != null &&
    msg.message_thread_id != null &&
    Number(config.requests_thread_id) !== Number(msg.message_thread_id)
  ) {
    return; // link posted in a different topic — not an inspo request
  }

  const senderName =
    msg.from?.username ?? msg.from?.first_name ?? null;

  for (const url of links) {
    const key = instagramKey(url);
    if (!key) continue;
    await supabase.from("content_links").upsert(
      {
        persona_id: config.persona_id,
        chat_id: msg.chat.id,
        message_thread_id: msg.message_thread_id ?? null,
        message_id: msg.message_id,
        url,
        url_key: key,
        posted_at: postedAt.toISOString(),
        sender_name: senderName,
        status: "open",
      },
      { onConflict: "chat_id,message_id", ignoreDuplicates: true }
    );
  }
}

/**
 * The model reacting to a link message means "I filmed this one".
 * Any reaction counts — she shouldn't have to remember a specific emoji.
 */
async function handleReaction(r: TgReactionUpdate) {
  if (!r.new_reaction || r.new_reaction.length === 0) return; // reaction removed

  const supabase = createAdminClient();

  const { data: link } = await supabase
    .from("content_links")
    .select("id, status")
    .eq("chat_id", r.chat.id)
    .eq("message_id", r.message_id)
    .maybeSingle();
  if (!link) return;

  // Don't walk the status backwards once it's further along.
  if (link.status !== "open") return;

  await supabase
    .from("content_links")
    .update({
      status: "shot",
      shot_at: new Date(r.date * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", link.id);
}
