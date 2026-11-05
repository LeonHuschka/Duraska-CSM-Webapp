import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractInstagramLinks,
  instagramKey,
  sendMessage,
  downloadFile,
  setMessageReaction,
  deleteMessage,
  editMessageCaption,
  entitiesToHtml,
  parseCaptionDate,
  type TgEntity,
  REACTION,
} from "@/lib/telegram";
import { extractMetricsFromImage } from "@/lib/vision";
import { findGrid, cutCell, type Cell } from "@/lib/grid";
import { matchTiles } from "@/lib/match-tile";
import { caption } from "@/lib/inspo-video";
import { postShootList, refreshShootList, swapIntoShootList } from "@/lib/shoot-list";

export const dynamic = "force-dynamic";
// Reading a grid means one Vision call to extract it and up to three more to
// identify the tiles. That does not fit in the ten seconds a function gets by
// default, and a screenshot that times out leaves no trace anywhere.
export const maxDuration = 60;

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
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  photo?: TgPhoto[];
  /** In a forum topic: the message that opened it, which carries its name. */
  reply_to_message?: { message_id?: number; forum_topic_created?: { name?: string } };
  forum_topic_created?: { name?: string };
};
type TgReactionUpdate = {
  chat: TgChat;
  message_id: number;
  user?: TgUser;
  date: number;
  new_reaction: { type: string; emoji?: string }[];
};
type TgUpdate = {
  message?: TgMessage;
  edited_message?: TgMessage;
  message_reaction?: TgReactionUpdate;
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

  let update: TgUpdate;
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
    // A slash command is not content and must never be filed as a link.
    if (msg && (await handleCommand(req, msg))) {
      return NextResponse.json({ ok: true });
    }
    // An edited message carries the same payload as a fresh one. Telegram
    // sends it whenever the sender fixes a typo — or when a client rewrites
    // the message after posting — and dropping it silently loses the link.
    if (msg) await handleMessage(req, msg);
    else if (update.message_reaction) await handleReaction(update.message_reaction);
  } catch (err) {
    // Always 200 — a non-2xx makes Telegram retry the same update forever.
    console.error("[telegram] handler failed", err);
  }

  return NextResponse.json({ ok: true });
}

/**
 * `/check` in the requests topic — take every 💔 back off the links.
 *
 * This once ran the availability check. That is gone: no combination of
 * scrapers could tell a deleted post from an age-gated one reliably enough
 * to be trusted with somebody's content, and the last run marked twenty live
 * links dead. All the command does now is undo, and it is safe to repeat.
 *
 * The command message itself is deleted straight away. The topic is the
 * model's work queue and holds links and nothing else, so the bot answers in
 * TALK and tidies up after the person who typed the command.
 *
 * Returns true when the message was a command and has been dealt with.
 */
const COMMANDS = new Set(["check", "links", "linkcheck", "cleanup", "undo"]);

async function handleCommand(req: Request, msg: TgMessage): Promise<boolean> {
  const text = (msg.text ?? "").trim();
  if (!text.startsWith("/")) return false;

  // "/check@DuraskaBot extra words" → "check"
  const word = text.slice(1).split(/\s+/)[0] ?? "";
  const name = word.split("@")[0].toLowerCase();
  if (name === "note") return handleNote(msg, text);
  if (name === "list") return handleShootList(msg);
  if (name === "shoot") return handleShoot(msg, text);
  if (!COMMANDS.has(name)) return false;

  const supabase = createAdminClient();
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("persona_id, requests_thread_id, talk_thread_id")
    .eq("chat_id", msg.chat.id)
    .maybeSingle();
  if (!cfg) return false;

  // Only from the requests topic, so the command means one thing.
  if (
    cfg.requests_thread_id != null &&
    msg.message_thread_id != null &&
    Number(cfg.requests_thread_id) !== Number(msg.message_thread_id)
  ) {
    return false;
  }


  // Keep the requests topic clean: the command itself does not belong in the
  // model's work queue. Fresh and the sender's own, so Telegram allows it.
  const tidy = await deleteMessage({
    chat_id: msg.chat.id,
    message_id: msg.message_id,
  });
  console.log(
    `[telegram] /${name} from @${msg.from?.username ?? "?"} — deleting their own fresh message: ${
      tidy.ok ? "allowed" : `refused (${tidy.error})`
    }`
  );

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[telegram] /check without CRON_SECRET");
    return true;
  }
  fireCleanup(req, cfg.persona_id, secret);
  return true;
}


/**
 * `/note new text` as a reply to an inspo — the bot's video or the original
 * link message — replaces its note, in the caption under the video and on
 * the link row. A bare `/note` clears it. Only as a
 * command, never any reply: "Noted here sir" must not become the note.
 * The command message is deleted again; a reply to anything else is left
 * standing, so whoever sent it sees nothing happened.
 */
async function handleNote(msg: TgMessage, text: string): Promise<boolean> {
  const target = msg.reply_to_message?.message_id;
  if (!target) return true;
  const supabase = createAdminClient();
  const { data: link } = await supabase
    .from("content_links")
    .select("id, url, video_message_id")
    .eq("chat_id", msg.chat.id)
    .or(`message_id.eq.${target},video_message_id.eq.${target}`)
    .limit(1)
    .maybeSingle();
  if (!link) return true;

  // Her formatting kept; the command itself dropped.
  const note = tidyNote(entitiesToHtml(msg.text ?? text, msg.entities, ["bot_command"])) || null;
  await supabase.from("content_links").update({ note }).eq("id", link.id);
  if (link.video_message_id != null) {
    const res = await editMessageCaption({
      chat_id: msg.chat.id,
      message_id: Number(link.video_message_id),
      caption: caption(link.url, note),
    });
    if (!res.ok) console.warn("[telegram] /note caption not edited:", res.error);
  }
  await deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id });
  return true;
}

/**
 * `/list` in SHOOTING — today's list again, picked anew and posted as a
 * fresh message in place of the old one. The command itself is tidied away.
 */
async function handleShootList(msg: TgMessage): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("persona_id, shoot_thread_id")
    .eq("chat_id", msg.chat.id)
    .maybeSingle();
  if (!cfg?.shoot_thread_id || Number(cfg.shoot_thread_id) !== Number(msg.message_thread_id)) return false;
  await deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id });
  console.log("[telegram] /list:", await postShootList(supabase, cfg.persona_id, true));
  return true;
}

/**
 * `/shoot` as a reply to an inspo — the bot's video or the original link
 * message — puts it on today's SHOOTING list, on top; the last open reel
 * there goes off it. `/shoot 3` takes #3 off instead. The bot answers in a
 * line and tidies the command and its answer away after a few seconds, so
 * the requests topic stays the model's queue.
 */
async function handleShoot(msg: TgMessage, text: string): Promise<boolean> {
  const answer = async (line: string) => {
    const sent = await sendMessage({
      chat_id: msg.chat.id,
      message_thread_id: msg.message_thread_id,
      reply_to_message_id: msg.message_id,
      text: line,
      disable_notification: true,
    });
    waitUntil(
      new Promise((r) => setTimeout(r, 12_000)).then(async () => {
        await deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id });
        if (sent.ok && sent.result) await deleteMessage({ chat_id: msg.chat.id, message_id: sent.result.message_id });
      })
    );
    return true;
  };
  const target = msg.reply_to_message?.message_id;
  if (!target) return answer("Reply with /shoot to the inspo that should go on today's list.");
  const supabase = createAdminClient();
  const { data: found } = await supabase
    .from("content_links")
    .select("id, persona_id, url_key")
    .eq("chat_id", msg.chat.id)
    .or(`message_id.eq.${target},video_message_id.eq.${target}`)
    .limit(1)
    .maybeSingle();
  if (!found) return answer("That message is not an inspo link.");
  // The bot's own repost of the reel, when there is one — that is what the list links to.
  const { data: repost } = await supabase
    .from("content_links")
    .select("id, message_id, video_message_id")
    .eq("persona_id", found.persona_id)
    .eq("url_key", found.url_key)
    .eq("status", "open")
    .not("video_message_id", "is", null);
  const linkId = (repost ?? []).find((l) => Number(l.message_id) === Number(l.video_message_id))?.id ?? found.id;
  const n = Number(text.split(/\s+/)[1]);
  const res = await swapIntoShootList(supabase, found.persona_id, linkId, Number.isInteger(n) && n > 0 ? n : null);
  return answer(res.text);
}

/** Runs of spaces to one, no blank lines beyond one, trimmed — line breaks kept. */
function tidyNote(html: string): string {
  return html
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Hand the job to its own invocation and stop caring about the answer. */
function fireCleanup(req: Request, personaId: string, secret: string) {
  fire(req, `/api/links/check?persona=${encodeURIComponent(personaId)}`, secret, "cleanup");
}

/** Fetch the reel behind a freshly posted link and repost it as a video. */
function fireVideo(req: Request, linkId: string, note: string, secret: string) {
  const q = new URLSearchParams({ link: linkId });
  // A cut through HTML would break the caption; a note that long goes plain.
  if (note) q.set("note", note.length <= 900 ? note : note.replace(/<[^>]+>/g, "").slice(0, 900).replace(/&[a-z]*$/, ""));
  fire(req, `/api/links/video?${q}`, secret, "video");
}

function fire(req: Request, path: string, secret: string, what: string) {
  const host = req.headers.get("host");
  if (!host) return;
  const url = `https://${host}${path}`;
  // waitUntil keeps this function alive past the response long enough for
  // the request to actually leave; without it Vercel may freeze us first.
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: { "x-link-check-secret": secret },
    })
      .then((res) => {
        // Silence here is how the first version failed: the session
        // middleware answered 307 and the redirect landed on /login, so
        // nothing ran and nothing anywhere said so.
        if (!res.ok) {
          console.error(`[telegram] ${what} answered`, res.status, res.url);
        }
      })
      .catch((err) => console.error(`[telegram] ${what} call failed`, err))
  );
}

async function handleMessage(req: Request, msg: TgMessage) {
  // The weekly pattern analysis goes into the topic named for it. Any
  // message there tells the bot which topic that is — no id to look up.
  const topic = msg.forum_topic_created?.name ?? msg.reply_to_message?.forum_topic_created?.name ?? "";
  if (msg.message_thread_id && /pattern\s*analys/i.test(topic)) {
    await rememberPatternTopic(req, msg.chat.id, msg.message_thread_id);
  }
  // The same for SHOOTING, where the day's list of reels to shoot goes.
  if (msg.message_thread_id && /^\W*shooting\b/i.test(topic)) {
    await rememberShootTopic(msg.chat.id, msg.message_thread_id);
  }

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
    const row = {
      persona_id: config.persona_id,
      chat_id: msg.chat.id,
      message_thread_id: msg.message_thread_id ?? null,
      message_id: msg.message_id,
      url,
      url_key: key,
      posted_at: postedAt.toISOString(),
      sender_name: senderName,
      status: "open",
    };
    // Keyed on the post, not just the message: a message with two links
    // used to store only the first, and once dead links get their message
    // deleted that would take an unrecorded live link down with it.
    const { error } = await supabase
      .from("content_links")
      .upsert(row, { onConflict: "chat_id,message_id,url_key", ignoreDuplicates: true });
    if (error) {
      // Until the migration that creates that key has run, Postgres has
      // nothing to resolve the conflict against and rejects the whole
      // insert. Falling back keeps links being recorded in the meantime —
      // losing them silently would be much worse than storing one per
      // message for a day.
      console.warn("[telegram] link upsert fell back to the old key:", error.message);
      await supabase
        .from("content_links")
        .upsert(row, { onConflict: "chat_id,message_id", ignoreDuplicates: true });
    }
  }

  // Now, while the post is still up: fetch the reel and reply with it. In
  // its own invocation — Telegram is waiting for this one to answer.
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const { data: stored } = await supabase
    .from("content_links")
    .select("id")
    .eq("chat_id", msg.chat.id)
    .eq("message_id", msg.message_id)
    .is("video_path", null)
    .is("video_error", null);
  // Whatever was written around the links is the note for the video.
  // The link regex stops at the shortcode, so a share link leaves its tail
  // behind ("/?stkn=…", "?igsh=…"). That is part of the URL, not something
  // the sender wrote — strip whole URLs before calling the rest a note.
  // Telegram marks every URL as an entity, tail included, so dropping
  // those entities drops exactly the links. Formatting and line breaks stay.
  const note = tidyNote(entitiesToHtml(text, msg.entities ?? msg.caption_entities, ["url"]));
  // Say "got it, fetching" on the link before the slow part starts. The
  // message is replaced by the video when it lands, so the eyes go with it.
  if ((stored ?? []).length > 0) {
    await setMessageReaction({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      emoji: REACTION.fetching,
    });
  }
  for (const l of stored ?? []) fireVideo(req, l.id, note, secret);
}

/**
 * Screenshot posted in a group that's mapped to an account → run it through
 * the vision model and store whatever numbers it could read.
 *
 * Only pictures from a listed sender, in a topic tied to an account, are
 * touched at all. Everywhere else the bot stays completely silent — the
 * instructions topic is a conversation, not a data source.
 *
 * Once it does engage it always answers, because the sender has no other
 * way to know: 👀 picked up, 💯 numbers stored, 🤔 stored but flagged for
 * review, 🤨 nothing readable.
 */
const SCREENSHOT_EXTRACTION_ENABLED = false;

async function handleScreenshot(msg: TgMessage) {
  const supabase = createAdminClient();

  // Only the people who manage the accounts get read. Anyone else posting a
  // picture in a topic — a screenshot of something unrelated, a meme —
  // would otherwise be run through the vision model and filed as numbers.
  // No reaction either: reacting to everything is its own kind of noise.
  const { data: senderCfg } = await supabase
    .from("telegram_config")
    .select("screenshot_senders")
    .eq("chat_id", msg.chat.id)
    .maybeSingle();
  const allowed = (senderCfg?.screenshot_senders ?? []) as string[];
  if (allowed.length > 0) {
    const from = (msg.from?.username ?? "").toLowerCase().replace(/^@/, "");
    if (!from || !allowed.some((a) => a.toLowerCase().replace(/^@/, "") === from)) {
      console.log("[telegram] screenshot from", from || "(no username)", "— not a listed sender");
      return;
    }
  }

  const react = (emoji: string) =>
    setMessageReaction({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      emoji,
    });

  // A date in the caption backdates the reading. Without one it is stamped
  // with the time the message arrived, which is what the daily routine
  // wants. Telegram only attaches a caption to the first photo of an album,
  // so a backfilled pair has to be sent as two separate messages.
  const backdated = parseCaptionDate(msg.caption);
  const capturedAt = (backdated ?? new Date(msg.date * 1000)).toISOString();
  if (backdated) {
    console.log("[telegram] backdated from caption", capturedAt);
  }

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
    // Not one of the account topics — the instructions topic, the requests
    // topic, any chat the bot happens to sit in. Nothing is read and
    // nothing is answered: a reaction here is noise in a conversation that
    // has nothing to do with statistics.
    console.log("[telegram] photo outside an account topic", msg.chat.id, "topic", thread);
    return;
  }

  // Off since 2026-09-06: the numbers come from a daily scrape of the
  // platform now (account-scrape.ts), which names every post by its own id
  // and never has to guess which tile is which reel. Nothing is read off a
  // screenshot any more, so nothing is answered either — a 👀 on every
  // picture was a promise of a reading that never came.
  if (!SCREENSHOT_EXTRACTION_ENABLED) {
    console.log(`[telegram] screenshot for @${account.handle} ignored — extraction is off`);
    return;
  }

  // Confirmed an account topic, so say "got it" before the slow part.
  await react(REACTION.seen);

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
    // The tile is a frame of a video we hold, so which reel it shows is
    // decided by comparing pictures, not by counting positions. Position
    // was never identity: an unrecorded posting, a pinned reel or a deleted
    // one shifts every tile after it, and the old logic had no way to
    // notice.
    //
    // The grid is read out of the picture; the model is asked only which
    // tiles are reels and what numbers they carry.
    const image = Buffer.from(file.base64, "base64");
    const cells = await findGrid(image);
    const used = new Set<number>();
    const crops: (Buffer | null)[] = [];
    for (const r of metrics.reels) {
      let idx = -1;
      if (r.box && cells.length) {
        const rc = { x: r.box.x + r.box.w / 2, y: r.box.y + r.box.h / 2 };
        let bestD = Infinity;
        cells.forEach((c: Cell, i: number) => {
          if (used.has(i)) return;
          const d = Math.hypot(c.x + c.w / 2 - rc.x, c.y + c.h / 2 - rc.y);
          if (d < bestD) {
            bestD = d;
            idx = i;
          }
        });
        // Further than a tile away is not a pairing, it is a coincidence.
        if (idx >= 0 && bestD >= Math.max(cells[0].w, cells[0].h)) idx = -1;
      }
      if (idx < 0) {
        crops.push(null);
        continue;
      }
      used.add(idx);
      try {
        crops.push(await cutCell(image, cells[idx]));
      } catch {
        crops.push(null);
      }
    }

    // One matcher for the bot and for the check page. Keeping two of them
    // in step failed: the page matched by landmarks for hours while this
    // path was still deciding with a perceptual hash.
    const result = await matchTiles(supabase, {
      personaId: account.persona_id,
      accountId: account.id,
      tiles: metrics.reels.map((r, i) => ({
        position: r.position,
        caption: r.caption,
        crop: crops[i],
      })),
    });
    const byPosition = new Map(result.tiles.map((t) => [t.position, t]));
    const confirmed = result.tiles.filter((t) => t.assetId && !t.needsCheck).length;
    const proposed = result.tiles.filter((t) => t.assetId && t.needsCheck).length;
    console.log(
      `[telegram] @${account.handle}: ${confirmed} confirmed, ${proposed} to check, ` +
        `of ${metrics.reels.length} tiles against ${result.landmarkPool} indexed cuts`
    );

    const { error: gridErr } = await supabase.from("reel_metrics").upsert(
      metrics.reels.map((r) => ({
        persona_id: account.persona_id,
        account_id: account.id,
        captured_at: capturedAt,
        position: r.position,
        asset_id: byPosition.get(r.position)?.assetId ?? null,
        request_id: byPosition.get(r.position)?.requestId ?? null,
        match_method: byPosition.get(r.position)?.method ?? null,
        match_score: byPosition.get(r.position)?.score ?? null,
        match_confirmed: byPosition.get(r.position)?.needsCheck === false,
        views: r.views,
        likes: r.likes,
        caption: r.caption,
        source_chat_id: msg.chat.id,
        source_message_id: msg.message_id,
        source_file_id: photo.file_id,
        confidence: metrics.confidence,
        needs_review:
          metrics.confidence < 0.6 || byPosition.get(r.position)?.needsCheck !== false,
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
    captured_at: capturedAt,
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

  // A message can carry several links and a reaction applies to the
  // message, so it applies to all of them.
  const { data: links } = await supabase
    .from("content_links")
    .select("id, status, persona_id")
    .eq("chat_id", r.chat.id)
    .eq("message_id", r.message_id);
  if (!links || links.length === 0) return;
  const ids = links.map((l) => l.id);
  const personaId = links[0].persona_id;

  // 💔 means "I opened this and the post is gone".
  //
  // The automated check can't establish that: Instagram shows a datacenter
  // IP the same login wall whether a reel exists or not, so a removed post
  // and a live one are indistinguishable from the server. A person who
  // clicked the link knows for certain, and this turns that knowledge into
  // the cleanup — no dashboard, no ticket, one reaction.
  if (r.new_reaction.some((x) => x.emoji === REACTION.dead)) {
    // Only while nothing has been produced from any of them. Once takes
    // exist the message is the trail back to them and must stay.
    if (links.some((l) => l.status !== "open" && l.status !== "shot")) return;

    await supabase
      .from("content_links")
      .update({
        status: "dead",
        link_ok: false,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    const res = await deleteMessage({
      chat_id: r.chat.id,
      message_id: r.message_id,
    });
    if (!res.ok) {
      console.log("[telegram] could not delete dead link message", res.error);
    }
    await refreshShootList(supabase, personaId);
    return;
  }

  // Any other reaction means the model has filmed it.
  // Don't walk the status backwards once it's further along.
  const open = links.filter((l) => l.status === "open").map((l) => l.id);
  if (open.length === 0) return;

  await supabase
    .from("content_links")
    .update({
      status: "shot",
      shot_at: new Date(r.date * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", open);
  await refreshShootList(supabase, personaId);
}

/**
 * Store the SHOOTING topic, once, say so in it and post today's list
 * straight away; from then on a new one comes every morning.
 */
async function rememberShootTopic(chatId: number, threadId: number) {
  const supabase = createAdminClient();
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("persona_id, shoot_thread_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!cfg || Number(cfg.shoot_thread_id) === threadId) return;
  await supabase.from("telegram_config").update({ shoot_thread_id: threadId }).eq("persona_id", cfg.persona_id);
  await sendMessage({
    chat_id: chatId,
    message_thread_id: threadId,
    text:
      "✅ Got it — every morning the day's reels to shoot land here: what is left from the day before, the oldest inspo links, and two fresh ones. Here is today's.",
  });
  console.log("[telegram] shooting list:", await postShootList(supabase, cfg.persona_id, true));
}

/**
 * Store the PATTERN ANALYSIS topic, once, and say so in it — then run the
 * past week's analysis straight away, so the topic does not sit empty
 * until the first Sunday.
 */
async function rememberPatternTopic(req: Request, chatId: number, threadId: number) {
  const supabase = createAdminClient();
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("persona_id, pattern_thread_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!cfg || cfg.pattern_thread_id === threadId) return;
  await supabase.from("telegram_config").update({ pattern_thread_id: threadId }).eq("persona_id", cfg.persona_id);
  await sendMessage({
    chat_id: chatId,
    message_thread_id: threadId,
    text: "✅ Got it — the weekly pattern analysis lands here every Sunday. Here is the past week's, starting now.",
  });
  const secret = process.env.CRON_SECRET;
  if (secret) fire(req, "/api/pattern?all=1", secret, "pattern analysis");
}
