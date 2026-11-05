import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { berlinDay } from "@/lib/berlin-day";
import {
  deleteMessage,
  editMessageText,
  instagramKey,
  messageExists,
  messageLink,
  pinChatMessage,
  sendMessage,
  type LinkButton,
} from "@/lib/telegram";
import { shootUrl } from "@/lib/shoot-token";
import { APP_URL, DIMENSIONS, DIM_META, cellName, type Dimension } from "@/lib/trials";
import { accountLabel } from "@/lib/account-analytics";

/**
 * The SHOOTING topic: one message a day with the reels to shoot. The
 * requests topic is a stack — the newest link on top, last week's out of
 * sight — so the list reaches back for the old ones: what is left from
 * yesterday first, then the oldest open links, and two of the newest so a
 * fresh trend does not wait for the backlog. Each line has a button to its
 * upload page and one to the inspo in the requests topic, and the message
 * is edited as the reels get shot. Under them, the running Trial-Maxxing
 * rounds, each with a button to its matrix in the app. There is only ever
 * one list in the topic: the morning's replaces yesterday's.
 */
export const SHOOT_PER_DAY = 5;

type Db = ReturnType<typeof createAdminClient>;

const DONE = new Set(["shot", "uploaded", "edited"]);

/**
 * What is left of yesterday, then the oldest open links, then the newest.
 * A reel goes in once, whatever number of times its link was posted, and
 * not at all once any posting of it is shot or has a job. Only links whose
 * reel the bot holds and reposted itself — an old link without a copy is
 * mostly a post that is gone — and whose message is still in the requests
 * topic: one deleted there is gone for the model too, and is let go.
 */
async function pick(db: Db, personaId: string, carry: string[]): Promise<string[]> {
  const [{ data: open }, taken] = await Promise.all([
    db
      .from("content_links")
      .select("id, url_key, chat_id, message_id, video_message_id")
      .eq("persona_id", personaId)
      .eq("status", "open")
      .not("link_ok", "is", false)
      .not("video_path", "is", null)
      .not("video_message_id", "is", null)
      .order("posted_at", { ascending: true })
      .limit(2000),
    takenKeys(db, personaId),
  ]);
  type L = NonNullable<typeof open>[number];
  const seen = new Set<string>();
  const candidates: L[] = [];
  for (const l of open ?? []) {
    if (Number(l.message_id) !== Number(l.video_message_id) || taken.has(l.url_key) || seen.has(l.url_key)) continue;
    seen.add(l.url_key);
    candidates.push(l);
  }

  // The message is checked only for the links that would go in.
  const alive = async (l: L) => {
    if (await messageExists(Number(l.chat_id), Number(l.message_id))) return true;
    await db
      .from("content_links")
      .update({ status: "dead", checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", l.id);
    console.log("[shoot-list] inspo message gone from the requests topic, link let go:", l.id);
    return false;
  };
  const chosen: string[] = [];
  const take = async (list: L[], n: number) => {
    for (const l of list) {
      if (n <= 0) return;
      if (chosen.includes(l.id) || !(await alive(l))) continue;
      chosen.push(l.id);
      n--;
    }
  };
  const byId = new Map(candidates.map((l) => [l.id, l]));
  await take(carry.map((id) => byId.get(id)).filter((l): l is L => !!l), SHOOT_PER_DAY);
  const need = SHOOT_PER_DAY - chosen.length;
  const fresh = need >= 4 ? 2 : need >= 2 ? 1 : 0;
  await take(candidates, need - fresh);
  await take([...candidates].reverse(), SHOOT_PER_DAY - chosen.length);
  return chosen;
}

/** The reels already shot, or with a job: any posting of their link is done. */
async function takenKeys(db: Db, personaId: string): Promise<Set<string>> {
  const [{ data: done }, { data: jobs }] = await Promise.all([
    db.from("content_links").select("url_key").eq("persona_id", personaId).in("status", ["shot", "uploaded", "edited"]).limit(5000),
    db.from("content_requests").select("inspo_link").eq("persona_id", personaId).not("inspo_link", "is", null).limit(5000),
  ]);
  const taken = new Set<string>((done ?? []).map((l) => l.url_key));
  for (const j of jobs ?? []) {
    const k = j.inspo_link ? instagramKey(j.inspo_link) : null;
    if (k) taken.add(k);
  }
  return taken;
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

async function render(db: Db, personaId: string, day: string, ids: string[]): Promise<{ text: string; keyboard: LinkButton[][] }> {
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

  const trial = await trialPart(db, personaId);
  const head =
    links.length === 0
      ? `🎬 <b>To shoot · ${date}</b>\n\nNothing open — every inspo link is shot. New ones go into the requests topic.`
      : `🎬 <b>To shoot · ${date}</b> — <b>${done}/${links.length}</b>${done === links.length ? " 🎉" : ""}\n\n${lines.join("\n")}`;
  const foot =
    `🎥 opens the upload with the inspo and notes filled in — add the videos and send.\n📍 jumps to the inspo in the requests topic.` +
    (trial.lines.length ? `\n🧪 opens the trial's matrix in the app.` : "");
  return {
    text: [head, ...(trial.lines.length ? [trial.lines.join("\n")] : []), foot].join("\n\n"),
    keyboard: [...keyboard, ...trial.keyboard],
  };
}

/**
 * The running Trial-Maxxing trials: per trial each round that has begun —
 * shot so far, what is left, the winner once picked — and a button to its
 * matrix. A round is shot ahead of its phase as often as not, so the
 * rounds are read from the boxes, not from the phase alone.
 */
async function trialPart(db: Db, personaId: string): Promise<{ lines: string[]; keyboard: LinkButton[][] }> {
  const { data: trials } = await db
    .from("trials")
    .select("id, account_id, phase, created_at")
    .eq("persona_id", personaId)
    .eq("status", "active")
    .neq("phase", "done")
    .order("created_at", { ascending: true });
  if (!trials?.length) return { lines: [], keyboard: [] };
  const accIds = trials.map((t) => t.account_id).filter((x): x is string => !!x);
  const [{ data: cells }, { data: accounts }] = await Promise.all([
    db
      .from("trial_cells")
      .select("id, trial_id, dimension, slot, label, finished_at, winner")
      .in("trial_id", trials.map((t) => t.id))
      .order("slot"),
    accIds.length
      ? db.from("accounts").select("id, handle, display_name").in("id", accIds)
      : Promise.resolve({ data: [] as { id: string; handle: string; display_name: string | null }[] }),
  ]);
  const accName = new Map((accounts ?? []).map((a) => [a.id, a.display_name || accountLabel(a.handle)]));

  const lines = ["🧪 <b>Trial-Maxxing</b>"];
  const keyboard: LinkButton[][] = [];
  for (const t of trials) {
    const mine = (cells ?? []).filter((c) => c.trial_id === t.id);
    const rounds: string[] = [];
    for (const d of DIMENSIONS) {
      const round = mine.filter((c) => c.dimension === d);
      if (!round.length) continue;
      const open = round.filter((c) => !c.finished_at);
      const won = round.filter((c) => c.winner);
      if (d !== t.phase && open.length === round.length && !won.length) continue; // not begun
      const head = `${DIM_META[d].emoji} ${DIM_META[d].title} — <b>${round.length - open.length}/${round.length}</b>`;
      rounds.push(
        won.length
          ? `${head} · 🏆 ${won.map((c) => esc(name(c))).join(", ")}`
          : open.length
            ? `${head}\n      to shoot: ${open.map((c) => esc(name(c))).join(", ")}`
            : `${head} · winner not picked yet`
      );
    }
    if (!rounds.length) continue;
    const who = t.account_id ? accName.get(t.account_id) ?? "" : "";
    lines.push(`<b>${esc(who || "Trial")}</b>\n${rounds.map((r) => `   ${r}`).join("\n")}`);
    keyboard.push([{ text: `🧪 ${who ? `${who} · ` : ""}open the trial`, url: `${APP_URL}/trials/${t.id}` }]);
  }
  return lines.length > 1 ? { lines, keyboard } : { lines: [], keyboard: [] };
}

const name = (c: { dimension: string; slot: number; label: string | null }) =>
  cellName({ dimension: c.dimension as Dimension, slot: c.slot, label: c.label });

/**
 * The morning's list, once a day: a new message in SHOOTING, pinned, in
 * place of yesterday's. Run
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

  // One list in the topic, ever: the old one goes before the new one comes.
  if (cfg.shoot_list_message_id) {
    await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(cfg.shoot_list_message_id) });
  }
  const ids = await pick(db, personaId, cfg.shoot_list_links ?? []);
  const { text, keyboard } = await render(db, personaId, today, ids);
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
    const { text, keyboard } = await render(db, personaId, cfg.shoot_list_day, cfg.shoot_list_links ?? []);
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

/**
 * `/shoot` from the requests topic: this inspo onto today's list, on top,
 * and one of today's open reels off it in its place — the last one, or
 * number `drop`. Nothing is lost by that: a reel let go of is still open
 * and comes back by age like any other. Says what it did, for the reply.
 */
export async function swapIntoShootList(
  db: Db,
  personaId: string,
  linkId: string,
  drop: number | null
): Promise<{ ok: boolean; text: string }> {
  const read = () =>
    db
      .from("telegram_config")
      .select("chat_id, shoot_thread_id, shoot_list_message_id, shoot_list_day, shoot_list_links")
      .eq("persona_id", personaId)
      .maybeSingle();
  let { data: cfg } = await read();
  if (!cfg?.chat_id || !cfg.shoot_thread_id) return { ok: false, text: "There is no SHOOTING topic yet." };
  // Before the morning's list is out, it comes first — the swap is into today's.
  if (cfg.shoot_list_day !== berlinDay(new Date()) || !cfg.shoot_list_message_id) {
    await postShootList(db, personaId);
    ({ data: cfg } = await read());
    if (!cfg?.shoot_list_message_id) return { ok: false, text: "Today's list could not be posted." };
  }

  const { data: link } = await db.from("content_links").select("id, url_key, status").eq("id", linkId).maybeSingle();
  if (!link) return { ok: false, text: "That is not an inspo link." };
  if (link.status === "dead") return { ok: false, text: "That inspo is marked as gone." };
  if (DONE.has(link.status) || (await takenKeys(db, personaId)).has(link.url_key)) {
    return { ok: false, text: "That reel is already shot." };
  }

  const ids = cfg.shoot_list_links ?? [];
  const { data: rows } = ids.length
    ? await db.from("content_links").select("id, url_key, status, posted_at").in("id", ids)
    : { data: [] };
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const at = ids.findIndex((id) => byId.get(id)?.url_key === link.url_key);
  if (at >= 0) return { ok: false, text: `That reel is already on today's list as #${at + 1}.` };

  const isOpen = (id: string) => {
    const r = byId.get(id);
    return !!r && r.status === "open";
  };
  let out: string | null = null;
  if (drop != null) {
    out = ids[drop - 1] ?? null;
    if (!out) return { ok: false, text: `Today's list has no #${drop}.` };
    if (!isOpen(out)) return { ok: false, text: `#${drop} is already shot — pick an open one.` };
  } else {
    out = [...ids].reverse().find(isOpen) ?? null;
  }

  const next = [link.id, ...ids.filter((id) => id !== out)];
  await db.from("telegram_config").update({ shoot_list_links: next }).eq("persona_id", personaId);
  await refreshShootList(db, personaId);
  const gone = out ? byId.get(out) : null;
  return {
    ok: true,
    text: `✅ On today's list as #1${gone ? ` — Inspo from ${dm(gone.posted_at)} (was #${ids.indexOf(out!) + 1}) is off it` : ""}.`,
  };
}
