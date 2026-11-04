import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { berlinDay } from "@/lib/berlin-day";
import { deleteMessage, editMessageText, messageLink, pinChatMessage, sendMessage, type LinkButton } from "@/lib/telegram";
import { shootUrl } from "@/lib/shoot-token";

/**
 * The SHOOTING topic: one message a day with the reels to shoot. The
 * requests topic is a stack — the newest link on top, last week's out of
 * sight — so the list reaches back for the old ones: what is left from
 * yesterday first, then the oldest open links, and two of the newest so a
 * fresh trend does not wait for the backlog. Each line has a button to its
 * upload page and one to the inspo in the requests topic, and the message
 * is edited as the reels get shot.
 */
export const SHOOT_PER_DAY = 5;

type Db = ReturnType<typeof createAdminClient>;

const DONE = new Set(["shot", "uploaded", "edited"]);

/**
 * What is left of yesterday, then the oldest open links, then the newest.
 * Only links whose reel the bot holds a copy of: an old link without one
 * is mostly a post that is gone, and there is nothing to shoot from it.
 */
async function pick(db: Db, personaId: string, carry: string[]): Promise<string[]> {
  const { data } = await db
    .from("content_links")
    .select("id")
    .eq("persona_id", personaId)
    .eq("status", "open")
    .not("link_ok", "is", false)
    .not("video_path", "is", null)
    .order("posted_at", { ascending: true })
    .limit(2000);
  const open = (data ?? []).map((l) => l.id);
  const openSet = new Set(open);
  const kept = carry.filter((id) => openSet.has(id)).slice(0, SHOOT_PER_DAY);
  const rest = open.filter((id) => !kept.includes(id));
  const need = SHOOT_PER_DAY - kept.length;
  const fresh = need >= 4 ? 2 : need >= 2 ? 1 : 0;
  const oldest = rest.slice(0, need - fresh);
  const newest = fresh > 0 ? rest.slice(oldest.length).slice(-fresh) : [];
  return [...kept, ...oldest, ...newest];
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Telegram note (HTML) as plain text. */
export function notePlain(note: string | null): string {
  return (note ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

const dm = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

async function render(db: Db, day: string, ids: string[]): Promise<{ text: string; keyboard: LinkButton[][] }> {
  const { data: rows } = ids.length
    ? await db
        .from("content_links")
        .select("id, chat_id, message_thread_id, message_id, status, posted_at, request_id")
        .in("id", ids)
    : { data: [] };
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const links = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l);
  const reqIds = links.map((l) => l.request_id).filter((x): x is string => !!x);
  const { data: reqs } = reqIds.length
    ? await db.from("content_requests").select("id, title").in("id", reqIds)
    : { data: [] };
  const title = new Map((reqs ?? []).map((r) => [r.id, r.title]));

  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const done = links.filter((l) => DONE.has(l.status)).length;
  const lines: string[] = [];
  const keyboard: LinkButton[][] = [];
  links.forEach((l, i) => {
    const n = i + 1;
    const what = `Inspo from ${dm(l.posted_at)}`;
    const jump = { text: `📍 ${n} · Inspo`, url: messageLink(Number(l.chat_id), Number(l.message_id), l.message_thread_id) };
    const upload = shootUrl(l.id);
    if (l.status === "dead") {
      lines.push(`✖️ ${n} · <s>${esc(what)}</s> — gone from Instagram`);
      return;
    }
    if (DONE.has(l.status)) {
      const t = l.request_id ? title.get(l.request_id) : null;
      lines.push(`✅ ${n} · <s>${esc(what)}</s>${t ? ` → ${esc(t)}` : ""}`);
      keyboard.push([...(upload ? [{ text: `✅ ${n} · ${t ?? "shot"}`, url: upload }] : []), jump]);
      return;
    }
    lines.push(`⬜ ${n} · ${esc(what)}`);
    keyboard.push([...(upload ? [{ text: `🎥 ${n} · Upload takes`, url: upload }] : []), jump]);
  });

  const head =
    links.length === 0
      ? `🎬 <b>To shoot · ${date}</b>\n\nNothing open — every inspo link is shot. New ones go into the requests topic.`
      : `🎬 <b>To shoot · ${date}</b> — <b>${done}/${links.length}</b>${done === links.length ? " 🎉" : ""}\n\n${lines.join("\n")}\n\n` +
        `🎥 opens the upload with the inspo and notes filled in — add the videos and send.\n📍 jumps to the inspo in the requests topic.`;
  return { text: head, keyboard };
}

/**
 * The morning's list, once a day: a new message in SHOOTING, pinned. Run
 * again the same day it only brings the message up to date — unless
 * `fresh`, which starts today's list over in a new message (when the
 * topic is first set, or on `/list` in it).
 */
export async function postShootList(db: Db, personaId: string, fresh = false): Promise<string> {
  const { data: cfg } = await db
    .from("telegram_config")
    .select("chat_id, shoot_thread_id, shoot_list_message_id, shoot_list_day, shoot_list_links")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!cfg?.chat_id || !cfg.shoot_thread_id) return "no SHOOTING topic";
  const today = berlinDay(new Date());
  if (!fresh && cfg.shoot_list_day === today && cfg.shoot_list_message_id) {
    await refreshShootList(db, personaId);
    return "already posted today";
  }

  if (fresh && cfg.shoot_list_day === today && cfg.shoot_list_message_id) {
    await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(cfg.shoot_list_message_id) });
  }
  const ids = await pick(db, personaId, cfg.shoot_list_links ?? []);
  const { text, keyboard } = await render(db, today, ids);
  const sent = await sendMessage({
    chat_id: cfg.chat_id,
    message_thread_id: cfg.shoot_thread_id,
    text,
    keyboard,
  });
  if (!sent.ok || !sent.result) return `not sent: ${sent.error}`;
  const messageId = sent.result.message_id;
  await db
    .from("telegram_config")
    .update({ shoot_list_message_id: messageId, shoot_list_day: today, shoot_list_links: ids })
    .eq("persona_id", personaId);
  const pin = await pinChatMessage({ chat_id: cfg.chat_id, message_id: messageId });
  return `${ids.length} reels${pin.ok ? "" : ` (not pinned: ${pin.error})`}`;
}

/** Today's list as the links stand now. Best effort — never fails a caller. */
export async function refreshShootList(db: Db, personaId: string): Promise<void> {
  try {
    const { data: cfg } = await db
      .from("telegram_config")
      .select("chat_id, shoot_list_message_id, shoot_list_day, shoot_list_links")
      .eq("persona_id", personaId)
      .maybeSingle();
    if (!cfg?.chat_id || !cfg.shoot_list_message_id || !cfg.shoot_list_day) return;
    const { text, keyboard } = await render(db, cfg.shoot_list_day, cfg.shoot_list_links ?? []);
    const res = await editMessageText({
      chat_id: cfg.chat_id,
      message_id: Number(cfg.shoot_list_message_id),
      text,
      keyboard,
    });
    if (!res.ok && !/not modified/i.test(res.error ?? "")) console.warn("[shoot-list] not edited:", res.error);
  } catch (err) {
    console.warn("[shoot-list] refresh failed", err);
  }
}
