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

/**
 * Links per run. The whole backlog of 106 came back in nine seconds, so
 * there is no reason to sweep it in slices — and doing it in one go is what
 * makes a run's unreachable share meaningful.
 */
const MAX_LINKS = 200;

/**
 * Above this share of unreachable links, the run describes the vantage
 * point rather than the posts, and nothing is deleted.
 *
 * Measured on 2026-08-28 against the real backlog: 59 of 106 came back
 * "not found" — 56%. Instagram does not lose half a topic's worth of posts
 * in a few weeks. What it does do is hide age-restricted and restricted
 * accounts from anyone not logged in, and the one link in that set Leon had
 * verified by hand as live was among the 59. So a high share is proof that
 * the check cannot see what the model sees, and the correct response is to
 * delete nothing and say so.
 *
 * This is not a switch anybody has to remember to flip: give the scraper a
 * session and the share drops to whatever is genuinely gone, and deletion
 * starts working on its own.
 */
const MAX_UNREACHABLE_SHARE = 0.25;

/** Don't spend money re-checking something we looked at this morning. */
const RECHECK_AFTER_H = 16;

/** How many separate runs, and how much calendar time, before deleting. */
const MIN_STRIKES = 3;
const MIN_AGE_H = 48;

/**
 * A link nobody has reacted to in a month is dropped without asking anyone.
 *
 * This needs no Instagram at all, and it is the only part of the cleanup
 * that cannot be wrong about the world: whether the post still exists is
 * irrelevant once the model has walked past it for four weeks. It is also
 * what actually keeps the topic short — the availability check only ever
 * catches the few that were taken down.
 *
 * A reaction of any kind moves a link to `shot` and it stops being eligible
 * forever, which is exactly the case Leon asked me to protect: she films it
 * today, Instagram loses the original next week, the message stays.
 */
const EXPIRE_AFTER_DAYS = 30;

/** Enough to clear a backlog in a few days without emptying a topic at once. */
const MAX_EXPIRE_DELETIONS = 30;

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
  /** Dropped for age alone, no Instagram involved. */
  expired: number;
  /** Still older than the cutoff after this run's cap. */
  expiredLeft: number;
  /** Deletions Telegram would not carry out. */
  refused: number;
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
    expired: 0,
    expiredLeft: 0,
    refused: 0,
    trusted: true,
    note: null,
  };

  // Age first: it costs nothing, needs no verdict, and takes those links out
  // of the batch the scraper would otherwise be paid to look at.
  const aged = await expireOldLinks(supabase, cfg.persona_id, now);
  base.expired = aged.deleted;
  base.expiredLeft = aged.left;
  base.refused = aged.refused;

  const staleBefore = new Date(now - RECHECK_AFTER_H * 3600_000).toISOString();
  const { data: due, error: dueErr } = await supabase
    .from("content_links")
    .select(
      "id, url, url_key, chat_id, message_id, link_ok, unreachable_since, unreachable_runs"
    )
    .eq("persona_id", cfg.persona_id)
    .eq("status", "open")
    .or(`checked_at.is.null,checked_at.lt.${staleBefore}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LINKS);

  // Without the columns this asks for there is nothing to run, and saying
  // "nothing due" would read as a clean bill of health.
  if (dueErr) {
    await stamp(supabase, cfg.persona_id);
    const broken = { ...base, trusted: false, note: `Datenbank: ${dueErr.message}` };
    await report(cfg, broken, trigger);
    return broken;
  }

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
  // And the share itself: see MAX_UNREACHABLE_SHARE.
  const missing = answered.filter((l) => states.get(l.url_key) === "unreachable");
  const share = answered.length > 0 ? missing.length / answered.length : 0;
  if (answered.length >= 10 && share > MAX_UNREACHABLE_SHARE) {
    reasons.push(
      `${missing.length} of ${answered.length} links (${Math.round(share * 100)}%) are unreachable from here — that is the vantage point, not the posts`
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
    // A run we don't believe must not build a case for deleting anything.
    // Otherwise the day the vantage point is fixed, every link that was only
    // ever invisible would already have its three strikes and go at once.
    if (!trusted) {
      await supabase
        .from("content_links")
        .update({ checked_at: new Date().toISOString() })
        .eq("id", l.id);
      continue;
    }

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
 * Drop links nobody reacted to within EXPIRE_AFTER_DAYS.
 *
 * No scraper, no verdict, no strikes — the only question is whether the
 * model has touched it, and a month of silence answers that. Rows are kept
 * as `skipped`, the status the schema already has for "dismissed without
 * being produced", so the history stays intact and they are never looked at
 * again.
 */
async function expireOldLinks(
  supabase: SupabaseClient<Database>,
  personaId: string,
  now: number
): Promise<{ deleted: number; left: number; refused: number }> {
  const cutoff = new Date(now - EXPIRE_AFTER_DAYS * 86_400_000).toISOString();
  const { data: old, error } = await supabase
    .from("content_links")
    .select("id, chat_id, message_id")
    .eq("persona_id", personaId)
    .eq("status", "open")
    .lt("posted_at", cutoff)
    .order("posted_at", { ascending: true });
  if (error || !old || old.length === 0) return { deleted: 0, left: 0, refused: 0 };

  // A message goes only when everything it carries has expired. Two links in
  // one message, one of them posted later or already reacted to, and the
  // message stays.
  const chatIds = Array.from(new Set(old.map((l) => Number(l.chat_id))));
  const messageIds = Array.from(new Set(old.map((l) => Number(l.message_id))));
  const { data: siblings } = await supabase
    .from("content_links")
    .select("id, chat_id, message_id, status")
    .in("chat_id", chatIds)
    .in("message_id", messageIds);

  const expiring = new Set(old.map((l) => l.id));
  const byMessage = new Map<string, { id: string; status: string }[]>();
  for (const s of siblings ?? []) {
    const key = `${s.chat_id}:${s.message_id}`;
    byMessage.set(key, [...(byMessage.get(key) ?? []), { id: s.id, status: s.status }]);
  }

  let deleted = 0;
  let refused = 0;
  let left = 0;
  const seen = new Set<string>();

  for (const l of old) {
    const key = `${l.chat_id}:${l.message_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rows = byMessage.get(key) ?? [];
    const stillOpen = rows.filter((r) => r.status === "open");
    if (stillOpen.length === 0 || !stillOpen.every((r) => expiring.has(r.id))) continue;

    if (deleted >= MAX_EXPIRE_DELETIONS) {
      left++;
      continue;
    }

    const res = await deleteMessage({
      chat_id: l.chat_id,
      message_id: Number(l.message_id),
    });
    if (!res.ok) {
      // Telegram refuses some deletions. Worth counting rather than
      // swallowing: if it refuses everything, the bot is missing the
      // can_delete_messages right and no amount of retrying will help.
      console.warn("[links] expiry deletion refused", l.message_id, res.error);
      refused++;
      continue;
    }
    deleted++;
    await supabase
      .from("content_links")
      .update({ status: "skipped", updated_at: new Date().toISOString() })
      .in(
        "id",
        rows.map((r) => r.id)
      );
  }

  return { deleted, left, refused };
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

  const lines = [`🔗 <b>Link-Check</b> (${trigger})`];

  // The age sweep runs whatever the scraper did, so it is reported first.
  if (r.expired > 0) {
    lines.push(
      `🗑 ${r.expired} ohne Reaktion seit über ${EXPIRE_AFTER_DAYS} Tagen — gelöscht`
    );
  }
  if (r.expiredLeft > 0) {
    lines.push(`   ${r.expiredLeft} weitere folgen beim nächsten Lauf`);
  }
  if (r.refused > 0) {
    lines.push(
      `⚠️ ${r.refused} konnte Telegram nicht löschen — dem Bot fehlt vermutlich das Recht „Nachrichten löschen"`
    );
  }

  if (!r.trusted) {
    if (r.checked > 0) {
      lines.push(
        `${r.checked} geprüft · ${r.alive} erreichbar · ${r.unreachable} nicht erreichbar`
      );
    }
    lines.push(`Nichts wegen Nichterreichbarkeit gelöscht. Grund: ${r.note}`);
  } else if (r.checked === 0) {
    if (r.expired === 0) lines.push("Nichts fällig.");
  } else {
    lines.push(
      `${r.checked} geprüft · ${r.alive} erreichbar · ${r.unreachable} nicht erreichbar`
    );
    if (r.deleted > 0) {
      lines.push(`🗑 ${r.deleted} ${r.deleted === 1 ? "Post" : "Posts"} nicht mehr vorhanden — gelöscht`);
    }
    if (r.watching > 0) {
      lines.push(
        `👁 ${r.watching} unter Beobachtung (erst nach ${MIN_STRIKES} Läufen und ${MIN_AGE_H} h)`
      );
    }
  }
  const text = lines.join("\n");

  await sendMessage({
    chat_id: cfg.chat_id,
    message_thread_id: cfg.talk_thread_id,
    text,
    disable_notification: true,
  });
}
