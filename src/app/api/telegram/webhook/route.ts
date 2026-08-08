import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractInstagramLinks,
  instagramKey,
  sendMessage,
  downloadFile,
  setMessageReaction,
  deleteMessage,
  REACTION,
} from "@/lib/telegram";
import { extractMetricsFromImage } from "@/lib/vision";

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
type TgPhoto = { file_id: string; file_size?: number; width: number };
type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: TgPhoto[];
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

  // One line per delivery, so "the bot did nothing" can be told apart from
  // "the bot was never called" without guessing. Keys and ids only — the
  // message text stays out of the logs.
  const msg = update.message ?? update.edited_message;
  console.log(
    "[telegram] update",
    JSON.stringify({
      keys: Object.keys(update),
      chat: msg?.chat?.id ?? update.message_reaction?.chat?.id ?? null,
      thread: msg?.message_thread_id ?? null,
      has_text: !!(msg?.text ?? msg?.caption),
      photos: msg?.photo?.length ?? 0,
    })
  );

  try {
    // An edited message carries the same payload as a fresh one. Telegram
    // sends it whenever the sender fixes a typo — or when a client rewrites
    // the message after posting — and dropping it silently loses the link.
    if (msg) await handleMessage(msg);
    else if (update.message_reaction) await handleReaction(update.message_reaction);
  } catch (err) {
    // Always 200 — a non-2xx makes Telegram retry the same update forever.
    console.error("[telegram] handler failed", err);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: TgMessage) {
  // A screenshot in an account group → read the stats off it.
  if (msg.photo && msg.photo.length > 0) {
    await handleScreenshot(msg);
    return;
  }

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
  if (links.length === 0) {
    console.log("[telegram] no instagram link in message");
    return;
  }

  const postedAt = new Date(msg.date * 1000);
  if (postedAt < IGNORE_BEFORE) {
    console.log("[telegram] link older than cutoff", postedAt.toISOString());
    return;
  }

  // Which persona does this chat belong to, and is this the requests topic?
  const { data: config, error: configErr } = await supabase
    .from("telegram_config")
    .select("persona_id, requests_thread_id")
    .eq("chat_id", msg.chat.id)
    .maybeSingle();
  if (!config) {
    // No row and a DB error are very different problems — a bad service-role
    // key looks exactly like "chat not wired up" unless we say so.
    console.log(
      "[telegram] no config for chat",
      msg.chat.id,
      configErr?.message ?? "(no row)"
    );
    return;
  }

  if (
    config.requests_thread_id != null &&
    msg.message_thread_id != null &&
    Number(config.requests_thread_id) !== Number(msg.message_thread_id)
  ) {
    console.log(
      "[telegram] wrong topic",
      msg.message_thread_id,
      "expected",
      config.requests_thread_id
    );
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
 * Screenshot posted in a group that's mapped to an account → run it through
 * the vision model and store whatever numbers it could read.
 *
 * Every outcome answers with a reaction, because the VA has no other way
 * to know: 👀 picked up, 💯 numbers stored, 🤔 stored but flagged for
 * review, 🤨 nothing readable, 🤷‍♂️ this topic isn't tied to an account.
 */
async function handleScreenshot(msg: TgMessage) {
  const supabase = createAdminClient();

  // Say "got it" before the slow part. Vision takes seconds and every exit
  // below used to be silent, so a VA could not tell a processed screenshot
  // from an ignored one — and the emoji that was meant to confirm it was
  // rejected by Telegram anyway.
  const react = (emoji: string) =>
    setMessageReaction({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      emoji,
    });
  await react(REACTION.seen);

  // Which account does this screenshot belong to? The accounts sit in
  // topics of one forum group, so the chat id is the same for all of them
  // and only the topic tells them apart. An account that does get its own
  // group is stored with no topic and matches chat-wide.
  const thread = msg.message_thread_id ?? null;
  const cols = "id, persona_id, handle, platform";
  let account: {
    id: string;
    persona_id: string;
    handle: string;
    platform: string;
  } | null = null;

  if (thread != null) {
    const { data } = await supabase
      .from("accounts")
      .select(cols)
      .eq("telegram_chat_id", msg.chat.id)
      .eq("telegram_thread_id", thread)
      .maybeSingle();
    account = data;
  }
  if (!account) {
    const { data } = await supabase
      .from("accounts")
      .select(cols)
      .eq("telegram_chat_id", msg.chat.id)
      .is("telegram_thread_id", null)
      .maybeSingle();
    account = data;
  }
  if (!account) {
    console.log("[telegram] screenshot from unmapped chat", msg.chat.id, "topic", thread);
    await react(REACTION.unmapped);
    return;
  }

  // Already processed? (Telegram can redeliver.)
  const { data: existing } = await supabase
    .from("account_metrics")
    .select("id")
    .eq("source_chat_id", msg.chat.id)
    .eq("source_message_id", msg.message_id)
    .maybeSingle();
  if (existing) return;

  // Largest rendition = most legible for the model.
  const photo = [...(msg.photo ?? [])].sort((a, b) => b.width - a.width)[0];
  if (!photo) {
    await react(REACTION.unreadable);
    return;
  }

  const file = await downloadFile(photo.file_id);
  if (!file) {
    await react(REACTION.unreadable);
    return;
  }

  const { data: metrics, error } = await extractMetricsFromImage(
    file.base64,
    file.mime
  );
  if (!metrics || error) {
    console.warn("[telegram] vision failed", error);
    await react(REACTION.unreadable);
    return;
  }
  if (metrics.metric_kind === "unknown" && metrics.confidence === 0) {
    // Not an analytics screenshot. Still answer — silence reads as a bug.
    await react(REACTION.unreadable);
    return;
  }

  // A grid is a list, not a measurement: one row per tile, keyed on the
  // message so Telegram redelivering the same photo changes nothing.
  if (metrics.reels.length > 0) {
    const { error: gridErr } = await supabase.from("reel_metrics").upsert(
      metrics.reels.map((r) => ({
        persona_id: account.persona_id,
        account_id: account.id,
        captured_at: new Date(msg.date * 1000).toISOString(),
        position: r.position,
        views: r.views,
        likes: r.likes,
        caption: r.caption,
        source_chat_id: msg.chat.id,
        source_message_id: msg.message_id,
        source_file_id: photo.file_id,
        confidence: metrics.confidence,
        needs_review: metrics.confidence < 0.6,
      })),
      { onConflict: "source_chat_id,source_message_id,position" }
    );
    // A rejected write used to look exactly like a successful one: the
    // reaction went on either way and the row simply wasn't there.
    if (gridErr) {
      console.error("[telegram] reel grid not stored", gridErr.message);
      await react(REACTION.unreadable);
      return;
    }

    await react(
      metrics.confidence < 0.6 ? REACTION.unsure : REACTION.read
    );
    return;
  }

  const { error: profileErr } = await supabase.from("account_metrics").insert({
    persona_id: account.persona_id,
    account_id: account.id,
    source_chat_id: msg.chat.id,
    source_message_id: msg.message_id,
    // Telegram keeps the file forever and hands it back for this id, so a
    // screenshot can be run through the extractor again after a prompt
    // change — without storing a single byte ourselves. The first ten
    // arrived before this existed and are gone for re-reading.
    source_file_id: photo.file_id,
    captured_at: new Date(msg.date * 1000).toISOString(),
    handle: metrics.handle ?? account.handle,
    platform: metrics.platform ?? account.platform,
    metric_kind: metrics.metric_kind,
    period: metrics.period,
    followers: metrics.followers,
    follows: metrics.follows,
    posts_count: metrics.posts_count,
    views: metrics.views,
    reach: metrics.reach,
    impressions: metrics.impressions,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    saves: metrics.saves,
    profile_visits: metrics.profile_visits,
    raw: JSON.parse(JSON.stringify(metrics)),
    confidence: metrics.confidence,
    needs_review: metrics.confidence < 0.6,
  });
  if (profileErr) {
    console.error("[telegram] profile metrics not stored", profileErr.message);
    await react(REACTION.unreadable);
    return;
  }

  await react(metrics.confidence < 0.6 ? REACTION.unsure : REACTION.read);
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

  // 💔 means "I opened this and the post is gone".
  //
  // The automated check can't establish that: Instagram shows a datacenter
  // IP the same login wall whether a reel exists or not, so a removed post
  // and a live one are indistinguishable from the server. A person who
  // clicked the link knows for certain, and this turns that knowledge into
  // the cleanup — no dashboard, no ticket, one reaction.
  if (r.new_reaction.some((x) => x.emoji === REACTION.dead)) {
    // Only while nothing has been produced from it. Once takes exist the
    // message is the trail back to them and must stay.
    if (link.status !== "open" && link.status !== "shot") return;

    await supabase
      .from("content_links")
      .update({
        status: "dead",
        link_ok: false,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    const res = await deleteMessage({
      chat_id: r.chat.id,
      message_id: r.message_id,
    });
    if (!res.ok) {
      console.log("[telegram] could not delete dead link message", res.error);
    }
    return;
  }

  // Any other reaction means the model has filmed it.
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
