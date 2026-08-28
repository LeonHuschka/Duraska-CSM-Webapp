import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { checkPosts, CONTROL_SHORTCODE, CONTROL_URL } from "@/lib/apify";
import { deleteMessage, sendMessage } from "@/lib/telegram";

/**
 * Take inspo links whose posts are gone out of the requests topic.
 *
 * Dead links pile up and the model works through them one by one to find
 * nothing, so removing them is worth real money. Removing a live one is
 * worse than leaving ten dead ones, though: the link is the only record of
 * what she was asked to shoot. An earlier version of this deleted on a
 * single bad answer and came within one run of wiping fifty-two valid
 * links, which is the whole reason for the caution below.
 *
 * What may be deleted:
 *   - only links still `open`. Once the model has reacted the reel is
 *     filmed, and whether Instagram still hosts the original is beside the
 *     point — the message is her own record and must stay. The status is
 *     re-read immediately before deleting, because she may well react in
 *     the seconds between the check and the deletion.
 *   - only when every link in that message is also gone. Messages can
 *     carry several.
 *   - only after the post has been unreachable on separate runs across
 *     days. "Not found" also means private, suspended or age-restricted,
 *     and those come back; deleted ones never do.
 *   - only while the run itself looks trustworthy — see below.
 */

/** Links per run. Whatever is left keeps its old checked_at and goes first next time. */
const MAX_LINKS = 40;

/** Don't spend money re-checking something we looked at this morning. */
const RECHECK_AFTER_H = 16;

/** How many separate runs, and how much calendar time, before deleting. */
const MIN_STRIKES = 3;
const MIN_AGE_H = 48;

/** Real attrition is a couple of links. More than this in one run is a bug. */
const MAX_DELETIONS = 8;

export type LinkCheckResult = {
  personaId: string;
  checked: number;
  alive: number;
  unreachable: number;
  deleted: number;
  watching: number;
  skipped: number;
  trusted: boolean;
  note: string | null;
};

export async function runLinkCheck(
  supabase: SupabaseClient<Database>,
  opts: { personaId?: string; trigger: string }
): Promise<LinkCheckResult[]> {
  let q = supabase
    .from("telegram_config")
    .select("persona_id, chat_id, talk_thread_id");
  if (opts.personaId) q = q.eq("persona_id", opts.personaId);
  const { data: configs } = await q;

  const out: LinkCheckResult[] = [];
  for (const cfg of configs ?? []) {
    const res = await runForPersona(supabase, cfg, opts.trigger);
    out.push(res);
  }
  return out;
}

type Cfg = {
  persona_id: string;
  chat_id: number | null;
  talk_thread_id: number | null;
};

async function runForPersona(
  supabase: SupabaseClient<Database>,
  cfg: Cfg,
  trigger: string
): Promise<LinkCheckResult> {
  const now = Date.now();
  const base: LinkCheckResult = {
    personaId: cfg.persona_id,
    checked: 0,
    alive: 0,
    unreachable: 0,
    deleted: 0,
    watching: 0,
    skipped: 0,
    trusted: true,
    note: null,
  };

  const staleBefore = new Date(now - RECHECK_AFTER_H * 3600_000).toISOString();
  const { data: due } = await supabase
    .from("content_links")
    .select(
      "id, url, url_key, chat_id, message_id, link_ok, unreachable_since, unreachable_runs"
    )
    .eq("persona_id", cfg.persona_id)
    .eq("status", "open")
    .or(`checked_at.is.null,checked_at.lt.${staleBefore}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LINKS);

  const links = due ?? [];
  if (links.length === 0) {
    await stamp(supabase, cfg.persona_id);
    // Still say so: somebody typed the command and their message was
    // deleted, so silence would read as the bot being broken.
    const idle = { ...base, note: "nothing due" };
    await report(cfg, idle, trigger);
    return idle;
  }

  // The control travels in the same run as the links, so it is answered
  // under the same conditions they are.
  const { states, error } = await checkPosts([
    ...links.map((l) => l.url),
    CONTROL_URL,
  ]);
  if (error) {
    await stamp(supabase, cfg.persona_id);
    const failed = { ...base, trusted: false, note: error };
    await report(cfg, failed, trigger);
    return failed;
  }

  // ── Is this run worth believing? ──
  //
  // Three ways it can be wrong, and all three look like "everything died".
  const reasons: string[] = [];
  if (states.get(CONTROL_SHORTCODE) !== "unreachable") {
    reasons.push("the control post came back as reachable");
  }
  const answered = links.filter((l) => states.has(l.url_key));
  if (answered.length === 0) {
    reasons.push("nothing was answered");
  } else if (!answered.some((l) => states.get(l.url_key) === "alive")) {
    reasons.push("not one link came back reachable");
  }
  // Links that were fine yesterday are the honest control: a handful may
  // genuinely have died overnight, half of them cannot have.
  const wereAlive = answered.filter((l) => l.link_ok === true);
  const stillAlive = wereAlive.filter((l) => states.get(l.url_key) === "alive");
  if (wereAlive.length >= 4 && stillAlive.length < wereAlive.length / 2) {
    reasons.push(
      `${wereAlive.length - stillAlive.length} of ${wereAlive.length} previously reachable links went at once`
    );
  }
  const trusted = reasons.length === 0;

  // ── Write what we saw ──
  const deletable: typeof links = [];
  let alive = 0;
  let unreachable = 0;
  let watching = 0;

  for (const l of links) {
    const state = states.get(l.url_key);
    if (state === "alive") {
      alive++;
      await supabase
        .from("content_links")
        .update({
          link_ok: true,
          checked_at: new Date().toISOString(),
          unreachable_since: null,
          unreachable_runs: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", l.id);
      continue;
    }
    if (state !== "unreachable") continue; // no verdict — leave it for next run

    unreachable++;
    const since = l.unreachable_since ?? new Date().toISOString();
    const runs = (l.unreachable_runs ?? 0) + 1;
    await supabase
      .from("content_links")
      .update({
        link_ok: false,
        checked_at: new Date().toISOString(),
        unreachable_since: since,
        unreachable_runs: runs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", l.id);

    const oldEnough = now - new Date(since).getTime() >= MIN_AGE_H * 3600_000;
    if (runs >= MIN_STRIKES && oldEnough) deletable.push(l);
    else watching++;
  }

  let deleted = 0;
  let skipped = 0;
  if (trusted && deletable.length > 0) {
    const res = await removeMessages(supabase, deletable);
    deleted = res.deleted;
    skipped = res.skipped;
    watching += res.skipped;
  } else {
    watching += deletable.length;
  }

  await stamp(supabase, cfg.persona_id);

  const result: LinkCheckResult = {
    ...base,
    checked: links.length,
    alive,
    unreachable,
    deleted,
    watching,
    skipped,
    trusted,
    note: trusted ? null : reasons.join("; "),
  };
  await report(cfg, result, trigger);
  return result;
}

/**
 * Delete the Telegram message behind each dead link — but only messages in
 * which nothing is still worth reading.
 */
async function removeMessages(
  supabase: SupabaseClient<Database>,
  candidates: { id: string; chat_id: number; message_id: number }[]
): Promise<{ deleted: number; skipped: number }> {
  // Everything the messages in question carry, not just the dead links.
  const messageIds = Array.from(new Set(candidates.map((c) => Number(c.message_id))));
  const chatIds = Array.from(new Set(candidates.map((c) => Number(c.chat_id))));
  const { data: siblings } = await supabase
    .from("content_links")
    .select("id, chat_id, message_id, status")
    .in("chat_id", chatIds)
    .in("message_id", messageIds);

  const doomed = new Set(candidates.map((c) => c.id));
  const byMessage = new Map<string, { id: string; status: string }[]>();
  for (const s of siblings ?? []) {
    const key = `${s.chat_id}:${s.message_id}`;
    const list = byMessage.get(key) ?? [];
    list.push({ id: s.id, status: s.status });
    byMessage.set(key, list);
  }

  let deleted = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (const c of candidates) {
    if (deleted >= MAX_DELETIONS) {
      skipped++;
      continue;
    }
    const key = `${c.chat_id}:${c.message_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rows = byMessage.get(key) ?? [];
    // Re-read rather than trusting the status from before the check: the
    // model may have reacted while the scraper was working.
    const stillOpen = rows.filter((r) => r.status === "open");
    const allDoomed = stillOpen.every((r) => doomed.has(r.id));
    if (!allDoomed || stillOpen.length === 0) {
      skipped++;
      continue;
    }

    const res = await deleteMessage({
      chat_id: c.chat_id,
      message_id: Number(c.message_id),
    });
    if (!res.ok) {
      console.warn("[links] could not delete message", c.message_id, res.error);
      skipped++;
      continue;
    }
    deleted++;
    await supabase
      .from("content_links")
      .update({ status: "dead", updated_at: new Date().toISOString() })
      .in(
        "id",
        rows.map((r) => r.id)
      );
  }

  return { deleted, skipped };
}

async function stamp(supabase: SupabaseClient<Database>, personaId: string) {
  await supabase
    .from("telegram_config")
    .update({ last_link_check_at: new Date().toISOString() })
    .eq("persona_id", personaId);
}

/**
 * A line in TALK saying what happened. Never in the requests topic — that
 * one is the model's work queue and stays free of chatter.
 */
async function report(cfg: Cfg, r: LinkCheckResult, trigger: string) {
  if (!cfg.chat_id) return;

  let text: string;
  if (!r.trusted) {
    text =
      `🔗 <b>Link-Check abgebrochen</b> (${trigger})\n` +
      `${r.note}. Nichts gelöscht — die Antworten sind nicht vertrauenswürdig.`;
  } else if (r.checked === 0) {
    text = `🔗 <b>Link-Check</b> (${trigger})\nNichts fällig, alle Links wurden vor Kurzem geprüft.`;
  } else {
    const lines = [
      `🔗 <b>Link-Check</b> (${trigger})`,
      `${r.checked} geprüft · ${r.alive} erreichbar · ${r.unreachable} nicht erreichbar`,
    ];
    if (r.deleted > 0) {
      lines.push(`🗑 ${r.deleted} ${r.deleted === 1 ? "Link" : "Links"} aus den Content Requests gelöscht`);
    }
    if (r.watching > 0) {
      lines.push(`👁 ${r.watching} unter Beobachtung (erst nach ${MIN_STRIKES} Läufen und ${MIN_AGE_H} h wird gelöscht)`);
    }
    if (r.deleted === 0 && r.watching === 0) lines.push("Nichts zu tun.");
    text = lines.join("\n");
  }

  await sendMessage({
    chat_id: cfg.chat_id,
    message_thread_id: cfg.talk_thread_id,
    text,
    disable_notification: true,
  });
}
