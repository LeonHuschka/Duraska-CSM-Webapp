import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendMessage, setMessageReaction } from "@/lib/telegram";

/**
 * Take back every 💔 the bot ever put on an inspo link, and let the links
 * back into the queue.
 *
 * The availability check is gone. It was asked to answer one question — is
 * this post still there — and no combination of scrapers answered it well
 * enough to be trusted with somebody's content: logged out, deleted and
 * age-gated posts are indistinguishable, and the cheap scrapers that claim
 * otherwise simply report everything they cannot see as deleted. The last
 * run marked twenty live links dead on exactly that mistake.
 *
 * So this undoes all of it. Both kinds of mark go: the ones from the
 * availability check (`dead`) and the ones from the thirty-day age rule
 * (`skipped`), because both put the same emoji on somebody's message and
 * Leon asked for the topic back the way it was.
 *
 * Everything here is safe to run twice. A link already restored is no longer
 * selected, a reaction already gone is cleared again for nothing, and a
 * message somebody deleted by hand answers "not found", which is the state
 * this was aiming at anyway.
 */

/** Telegram tolerates a steady trickle far better than a burst. */
const PAUSE_MS = 120;

/** Per run, so one invocation cannot outlive its own timeout. */
const MAX_PER_RUN = 150;

export type CleanupResult = {
  personaId: string;
  /** Messages whose reaction was taken off. */
  cleared: number;
  /** Already gone from the chat — nothing left to clear. */
  vanished: number;
  /** Telegram refused, and not because the message was missing. */
  refused: number;
  /** Still marked after this run's cap. */
  left: number;
};

export async function undoAllMarks(
  supabase: SupabaseClient<Database>,
  opts: { personaId?: string; notifyChat?: boolean } = {}
): Promise<CleanupResult[]> {
  let q = supabase.from("telegram_config").select("persona_id, chat_id, talk_thread_id");
  if (opts.personaId) q = q.eq("persona_id", opts.personaId);
  const { data: configs } = await q;

  const out: CleanupResult[] = [];
  for (const cfg of configs ?? []) {
    const res = await undoForPersona(supabase, cfg.persona_id);
    out.push(res);

    if (opts.notifyChat !== false && cfg.chat_id) {
      const lines = [
        "🧹 <b>Aufgeräumt</b>",
        `${res.cleared} Reaktionen entfernt · ${res.vanished} Nachrichten waren schon weg`,
      ];
      if (res.refused > 0) lines.push(`⚠️ ${res.refused} hat Telegram verweigert`);
      if (res.left > 0) lines.push(`↩︎ ${res.left} übrig — nochmal ausführen`);
      else lines.push("Alle Links sind wieder offen. Die Prüfung ist abgeschaltet.");
      await sendMessage({
        chat_id: cfg.chat_id,
        message_thread_id: cfg.talk_thread_id,
        text: lines.join("\n"),
        disable_notification: true,
      });
    }
  }
  return out;
}

async function undoForPersona(
  supabase: SupabaseClient<Database>,
  personaId: string
): Promise<CleanupResult> {
  const res: CleanupResult = {
    personaId,
    cleared: 0,
    vanished: 0,
    refused: 0,
    left: 0,
  };

  const { data: marked, error } = await supabase
    .from("content_links")
    .select("id, chat_id, message_id")
    .eq("persona_id", personaId)
    .in("status", ["dead", "skipped"])
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[cleanup] could not read marked links", error.message);
    return res;
  }
  const rows = marked ?? [];
  if (rows.length === 0) return res;

  // One message can carry several links; the reaction sits on the message,
  // so it is taken off once and every link on it is restored together.
  const byMessage = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.chat_id}:${r.message_id}`;
    byMessage.set(key, [...(byMessage.get(key) ?? []), r.id]);
  }

  const stamped = new Date().toISOString();
  let handled = 0;

  for (const [key, ids] of Array.from(byMessage.entries())) {
    if (handled >= MAX_PER_RUN) {
      res.left += ids.length;
      continue;
    }
    handled++;

    const [chatId, messageId] = key.split(":");
    const cleared = await setMessageReaction({
      chat_id: Number(chatId),
      message_id: Number(messageId),
      emoji: null, // an empty reaction list is how Telegram takes one off
    });

    if (!cleared.ok) {
      if (/not found/i.test(cleared.error ?? "")) {
        // Somebody removed the message by hand. Nothing to un-react, and the
        // row should stop coming back round — leave it as it is.
        res.vanished++;
        continue;
      }
      console.warn("[cleanup] could not clear", messageId, cleared.error);
      res.refused++;
      continue;
    }

    // Back into the model's queue, and with no memory of the verdict that
    // put it here — a wrong `link_ok: false` left standing would colour
    // whatever gets built next.
    const { error: upErr } = await supabase
      .from("content_links")
      .update({
        status: "open",
        link_ok: null,
        hidden_confirmed: false,
        checked_at: null,
        unreachable_since: null,
        unreachable_runs: 0,
        updated_at: stamped,
      })
      .in("id", ids);
    if (upErr) console.warn("[cleanup] could not restore rows for", messageId, upErr.message);

    res.cleared++;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(
    `[cleanup] ${personaId}: ${res.cleared} entfernt, ${res.vanished} schon weg, ` +
      `${res.refused} verweigert, ${res.left} übrig`
  );
  return res;
}
