import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canDeleteMessages,
  deleteMessage,
  editMessageText,
  sendMessage,
} from "@/lib/telegram";

/**
 * What is the bot actually allowed to do to these messages?
 *
 * The link check finds dead posts correctly and then cannot remove a single
 * one: Telegram answers every deletion with "message can't be deleted",
 * which it says both when the bot lacks the right and when the message is
 * past its window. Three workarounds were on the table — edit the text
 * instead of deleting, hope an edit resets the age, forward-and-delete —
 * and none of them can be settled by reading. So they are tried, on the
 * real chat, against the real messages.
 *
 * Every test is safe to fail and safe to succeed: the only foreign message
 * touched is one whose post is already confirmed gone, so a deletion that
 * works is a link cleaned up rather than damage.
 */

type Step = { name: string; ok: boolean | null; detail: string };

export async function diagnoseDeletion(opts: {
  chatId: number;
  talkThreadId: number | null;
  personaId: string;
  /** The message the person typed to start this — fresh, and theirs. */
  commandMessageId: number;
  /**
   * An older message to try edit and delete on, given as "/diag <id>" or a
   * pasted t.me link. Point it at one of the bot's OWN old messages — a
   * link-check report from days ago — and it answers the only question the
   * documentation leaves open: whether the 48-hour limit binds a bot on its
   * own messages too. Nothing in the API reference exempts them, and the
   * strongest exemption there ("can delete any message") has already been
   * measured not to beat the clock.
   */
  targetMessageId?: number | null;
}): Promise<string> {
  const steps: Step[] = [];
  const say = (name: string, ok: boolean | null, detail: string) =>
    steps.push({ name, ok, detail });

  // 1 — what rank does the bot hold, and may it delete at all
  const rights = await canDeleteMessages(opts.chatId);
  say(
    "Rechte des Bots",
    rights.known ? rights.admin && rights.canDelete : null,
    rights.known
      ? `Status "${rights.note}", Recht „Nachrichten löschen“: ${rights.canDelete ? "ja" : "NEIN"}`
      : rights.note
  );

  // 2 — its own message: send, edit, delete. If editing works here and not
  //     on a foreign message, the difference is ownership, not permission.
  const own = await sendMessage({
    chat_id: opts.chatId,
    message_thread_id: opts.talkThreadId,
    text: "Testnachricht des Bots — wird gleich wieder entfernt.",
    disable_notification: true,
  });
  const ownId = (own.result as { message_id?: number } | undefined)?.message_id;
  if (!own.ok || !ownId) {
    say("Eigene Nachricht senden", false, own.error ?? "keine message_id");
  } else {
    say("Eigene Nachricht senden", true, `id ${ownId}`);
    const edited = await editMessageText({
      chat_id: opts.chatId,
      message_id: ownId,
      text: "Testnachricht des Bots — bearbeitet.",
    });
    say("Eigene Nachricht bearbeiten", edited.ok, edited.error ?? "ging");
    const removed = await deleteMessage({ chat_id: opts.chatId, message_id: ownId });
    say("Eigene Nachricht löschen", removed.ok, removed.error ?? "ging");
  }

  // 3 — the decisive one. A message belonging to the person who typed the
  //     command, seconds old. If this fails, rank is the obstacle and no
  //     permission or workaround changes it; if it works, only age is.
  const fresh = await deleteMessage({
    chat_id: opts.chatId,
    message_id: opts.commandMessageId,
  });
  say(
    "FREMDE Nachricht löschen (deine, frisch)",
    fresh.ok,
    fresh.error ?? "ging — dann liegt es allein am Alter"
  );

  // 4 + 5 — a foreign message weeks old, whose post is already confirmed
  //         gone. Editing it is the workaround under discussion; deleting
  //         it is what the check needs.
  const supabase = createAdminClient();
  const { data: old } = await supabase
    .from("content_links")
    .select("message_id, url_key")
    .eq("persona_id", opts.personaId)
    .eq("status", "open")
    .eq("link_ok", false)
    .order("posted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!old) {
    say("ALTE Nachricht", null, "kein bestätigt toter Link zum Testen gefunden");
  } else {
    const oldId = Number(old.message_id);
    const edit = await editMessageText({
      chat_id: opts.chatId,
      message_id: oldId,
      text: "❌ Post nicht mehr verfügbar",
    });
    say(
      "ALTE fremde Nachricht bearbeiten",
      edit.ok,
      edit.error ?? "ging — dann brauchen wir gar nicht zu löschen"
    );
    const del = await deleteMessage({ chat_id: opts.chatId, message_id: oldId });
    say("ALTE fremde Nachricht löschen", del.ok, del.error ?? "ging");
  }

  // A message named on the command line — meant to be one of the bot's own,
  // older than two days.
  if (opts.targetMessageId) {
    const id = opts.targetMessageId;
    const edit = await editMessageText({
      chat_id: opts.chatId,
      message_id: id,
      text: "🧪 Diagnose: diese Nachricht wurde vom Bot bearbeitet.",
    });
    say(`Nachricht ${id} bearbeiten`, edit.ok, edit.error ?? "ging");
    const del = await deleteMessage({ chat_id: opts.chatId, message_id: id });
    say(`Nachricht ${id} löschen`, del.ok, del.error ?? "ging");
  }

  const mark = (ok: boolean | null) => (ok === null ? "•" : ok ? "✅" : "❌");
  const lines = [
    "🧪 <b>Diagnose: was darf der Bot?</b>",
    ...steps.map((s) => `${mark(s.ok)} ${s.name}\n   <i>${escapeHtml(s.detail)}</i>`),
  ];

  // The one sentence Leon actually needs out of all this.
  const freshOk = steps.find((s) => s.name.startsWith("FREMDE"))?.ok;
  lines.push(
    "",
    freshOk === true
      ? "→ Der Bot darf deine Nachrichten löschen. Die alten scheitern also am 48-Stunden-Fenster."
      : freshOk === false
        ? "→ Der Bot darf deine Nachrichten überhaupt nicht löschen. Das ist der Rang, nicht das Alter — Links müssen künftig von jemandem kommen, der nicht Eigentümer der Gruppe ist."
        : "→ Kein Urteil."
  );

  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
