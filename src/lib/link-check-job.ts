import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  checkPosts,
  checkPostsDetailed,
  CONTROL_SHORTCODE,
  CONTROL_URL,
  DETAIL_BATCH,
  RUN_DEADLINE_MS,
} from "@/lib/apify";
import {
  editMessageText,
  sendMessage,
  setMessageReaction,
  REACTION,
} from "@/lib/telegram";

/**
 * Mark the inspo links that are no longer worth opening.
 *
 * It marks rather than deletes, because deleting turned out to be
 * impossible. Telegram refuses to remove a message more than 48 hours old,
 * and — measured, not assumed — an administrator bot holding
 * can_delete_messages is no exception, despite the reference promising it
 * "can delete any message there". Inspo links die weeks after they are
 * posted, so by the time anyone knows, the window has been shut for a
 * fortnight. Only a real user account could still remove them.
 *
 * So the bot puts a 💔 on the message instead. That is unambiguous, it
 * costs nothing to be wrong about, and clearing the topic stays a
 * two-minute job for a person rather than something nobody can do at all.
 *
 * What gets marked:
 *   - only links still `open`. Once the model has reacted the reel is
 *     filmed, and whether Instagram still hosts the original is beside the
 *     point — the message is her own record. The status is re-read
 *     immediately before marking, because she may well react in the seconds
 *     between the check and the mark.
 *   - only when every link in that message is also gone. Messages can
 *     carry several, and a 💔 over a live one would be a lie.
 *   - only when the second pass says the post does not exist, never on the
 *     cheap pass alone. The cheap one's "not found" also covers private,
 *     suspended and age-restricted, which is how the earlier version came
 *     to condemn 59 of 106 links, one of them verified alive by hand.
 *   - only while the run itself looks trustworthy — see below. A wrong mark
 *     is visible and can be taken off again, so this is now a matter of not
 *     crying wolf rather than of avoiding damage.
 */

/**
 * Links per run. The whole backlog of 106 came back in nine seconds, so
 * there is no reason to sweep it in slices — and doing it in one go is what
 * makes a run's unreachable share meaningful.
 */
const MAX_LINKS = 200;

/**
 * A runaway brake, not a judgment.
 *
 * The second pass tells a deleted post from a hidden one, so a quarter of a
 * months-old backlog being gone is ordinary — measured against the real
 * links, 28 of 106. What is not ordinary is nearly all of them, which is
 * what a blocked or broken scraper looks like from here. The sharper guards
 * are the control post and yesterday's reachable links; this one only
 * catches the case where everything goes at once.
 */
const MAX_UNREACHABLE_SHARE = 0.7;

/** Don't spend money re-checking something we looked at this morning. */
const RECHECK_AFTER_H = 16;

// No strike count, on purpose. A link is deleted in the run that finds it
// gone, and the safety lives entirely in what counts as "gone": only the
// detail pass may say it, and only in a run that passed every guard below.
// Waiting for a repeat protected against one scraper hiccup and cost the
// model days of opening dead links — the wrong trade, and a second look
// under identical conditions was never much of a second opinion anyway.

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

/** Marking is reversible, so the whole backlog can be done in one pass. */
const MAX_EXPIRE_DELETIONS = 80;

/**
 * A brake against a run that has gone mad, not a pace limit.
 *
 * Generous now that the outcome is a 💔 rather than a deletion: a wrong
 * mark is visible and can be taken off again, where a wrong deletion was
 * gone for good. The guards above still decide whether a run may mark
 * anything at all.
 */
const MAX_DELETIONS = 60;

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
  opts: { personaId?: string; trigger: string; force?: boolean }
): Promise<LinkCheckResult[]> {
  let q = supabase
    .from("telegram_config")
    .select("persona_id, chat_id, talk_thread_id");
  if (opts.personaId) q = q.eq("persona_id", opts.personaId);
  const { data: configs } = await q;

  const out: LinkCheckResult[] = [];
  for (const cfg of configs ?? []) {
    const res = await runForPersona(supabase, cfg, opts.trigger, opts.force ?? false);
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
  trigger: string,
  force: boolean
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

  // Say we started, before anything that can time out.
  //
  // The scrapers together can outlast the minute the function gets — one run
  // spent 6s on the cheap pass and 56s on the detailed one and was killed
  // before it could report, which from the group looked exactly like the
  // command having done nothing at all. Now the line appears first and is
  // rewritten with the result; a run that dies leaves "läuft" standing,
  // which is a true statement about what happened and a visible one.
  const notice = await announce(cfg, trigger);

  // A person who typed the command wants to see something happen; the
  // schedule wants to spend nothing twice in a day. Same job, different
  // patience — so the window only applies when nobody asked.
  const staleBefore = new Date(now - RECHECK_AFTER_H * 3600_000).toISOString();
  let q = supabase
    .from("content_links")
    .select(
      "id, url, url_key, chat_id, message_id, link_ok, hidden_confirmed, unreachable_since, unreachable_runs"
    )
    .eq("persona_id", cfg.persona_id)
    .eq("status", "open");
  if (!force) q = q.or(`checked_at.is.null,checked_at.lt.${staleBefore}`);
  const { data: due, error: dueErr } = await q
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LINKS);

  // Without the columns this asks for there is nothing to run, and saying
  // "nothing due" would read as a clean bill of health.
  if (dueErr) {
    await stamp(supabase, cfg.persona_id);
    const broken = { ...base, trusted: false, note: `Datenbank: ${dueErr.message}` };
    await report(cfg, broken, trigger, notice);
    return broken;
  }

  const links = due ?? [];
  if (links.length === 0) {
    await stamp(supabase, cfg.persona_id);
    // Still say so: somebody typed the command and their message was
    // deleted, so silence would read as the bot being broken.
    const idle = { ...base, note: "nothing due" };
    await report(cfg, idle, trigger, notice);
    return idle;
  }

  // ── First pass: cheap, and only ever trusted when it says "alive" ──
  const { states, error } = await checkPosts([
    ...links.map((l) => l.url),
    CONTROL_URL,
  ]);

  // ── Second pass: what the first could not see, asked once ──
  //
  // The cheap scraper's "not found" covers deleted, private, suspended and
  // age-restricted alike. This one tells those apart at nine times the
  // price, so two rules keep it small.
  //
  // It only sees links the cheap pass could not confirm — and of those,
  // only ones we have never had an answer for. A link this pass has already
  // found alive is hidden, not gone, and hidden does not become deleted by
  // being asked again tomorrow; re-asking was quietly re-buying the same
  // answer every single run. Anything still hidden a month on leaves by the
  // age rule regardless, which is why nothing needs re-verifying here.
  const unsure = links.filter(
    (l) => states.get(l.url_key) !== "alive" && !l.hidden_confirmed
  );
  const detailUrls = unsure.slice(0, DETAIL_BATCH).map((l) => l.url);
  const detail = await checkPostsDetailed(
    detailUrls.length > 0 ? [...detailUrls, CONTROL_URL] : [],
    // Whatever is left of the minute, minus what reporting and deleting
    // need. Running out here costs a day; running out after the deletions
    // but before the report leaves nobody knowing what happened.
    now + RUN_DEADLINE_MS - Date.now()
  );

  // Which links the cheap pass could see at all. A link the expensive pass
  // calls alive that this set does not contain is hidden rather than public,
  // and that is the state worth remembering — it will not change back.
  const publiclyVisible = new Set(
    links.filter((l) => states.get(l.url_key) === "alive").map((l) => l.url_key)
  );

  // Only this pass may condemn anything, so the cheap pass's "missing" is
  // wiped for every link before its answers are laid over the top. Without
  // this, a second pass that times out leaves the cheap verdicts standing
  // and the report announces 35 posts gone on the strength of a scraper
  // that cannot tell gone from hidden.
  for (const l of links) {
    if (states.get(l.url_key) === "unreachable") states.delete(l.url_key);
  }
  detail.states.forEach((state, code) => states.set(code, state));

  if (error) {
    await stamp(supabase, cfg.persona_id);
    const failed = { ...base, trusted: false, note: error };
    await report(cfg, failed, trigger, notice);
    return failed;
  }

  // ── Is this run worth believing? ──
  //
  // Every way this can go wrong looks the same from the inside: everything
  // reads as gone. So each of these has to hold before a single message is
  // touched.
  const reasons: string[] = [];
  if (states.get(CONTROL_SHORTCODE) !== "unreachable") {
    reasons.push("the control post came back as reachable");
  }
  if (detail.error) {
    // Only the second pass can tell gone from hidden, so without it there is
    // no deletable verdict at all — whatever the cheap one said.
    reasons.push(detail.error);
  }
  if (detailUrls.length > 0 && !detail.states.size) {
    reasons.push("the second pass answered nothing");
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
          hidden_confirmed: !publiclyVisible.has(l.url_key),
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
    // A run we don't believe leaves no trace beyond "we looked".
    if (!trusted) {
      await supabase
        .from("content_links")
        .update({ checked_at: new Date().toISOString() })
        .eq("id", l.id);
      continue;
    }

    await supabase
      .from("content_links")
      .update({
        link_ok: false,
        checked_at: new Date().toISOString(),
        unreachable_since: l.unreachable_since ?? new Date().toISOString(),
        unreachable_runs: (l.unreachable_runs ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", l.id);

    deletable.push(l);
  }

  let deleted = 0;
  let skipped = 0;
  if (trusted && deletable.length > 0) {
    const res = await removeMessages(supabase, deletable);
    deleted = res.deleted;
    skipped = res.skipped;
    watching += res.skipped;
    base.refused += res.refused;
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
  await report(cfg, result, trigger, notice);
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

    const res = await setMessageReaction({
      chat_id: l.chat_id,
      message_id: Number(l.message_id),
      emoji: REACTION.dead,
    });
    if (!res.ok) {
      console.warn("[links] could not mark expired link", l.message_id, res.error);
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
): Promise<{ deleted: number; skipped: number; refused: number }> {
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
  let refused = 0;
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

    const res = await setMessageReaction({
      chat_id: c.chat_id,
      message_id: Number(c.message_id),
      emoji: REACTION.dead,
    });
    if (!res.ok) {
      console.warn("[links] could not mark message", c.message_id, res.error);
      refused++;
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

  return { deleted, skipped, refused };
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
/** The placeholder the result will be written over. */
async function announce(cfg: Cfg, trigger: string): Promise<number | null> {
  if (!cfg.chat_id) return null;
  const res = await sendMessage({
    chat_id: cfg.chat_id,
    message_thread_id: cfg.talk_thread_id,
    text: `🔗 <b>Link-Check läuft…</b> (${trigger})`,
    disable_notification: true,
  });
  const id = (res.result as { message_id?: number } | undefined)?.message_id;
  if (!res.ok) console.error("[links] could not announce the run", res.error);
  return typeof id === "number" ? id : null;
}

async function report(
  cfg: Cfg,
  r: LinkCheckResult,
  trigger: string,
  editing: number | null
) {
  if (!cfg.chat_id) return;

  const lines = [`🔗 <b>Link-Check</b> (${trigger})`];

  // The age sweep runs whatever the scraper did, so it is reported first.
  if (r.expired > 0) {
    lines.push(
      `💔 ${r.expired} ohne Reaktion seit über ${EXPIRE_AFTER_DAYS} Tagen — markiert`
    );
  }
  if (r.expiredLeft > 0) {
    lines.push(`   ${r.expiredLeft} weitere folgen beim nächsten Lauf`);
  }
  if (r.refused > 0) {
    lines.push(`⚠️ ${r.refused} konnten nicht markiert werden`);
  }

  if (!r.trusted) {
    if (r.checked > 0) {
      lines.push(
        `${r.checked} geprüft · ${r.alive} vorhanden · ${r.unreachable} nicht mehr vorhanden`
      );
    }
    lines.push(`Nichts wegen Löschung entfernt. Grund: ${r.note}`);
  } else if (r.checked === 0) {
    if (r.expired === 0) lines.push("Nichts fällig.");
  } else {
    lines.push(
      `${r.checked} geprüft · ${r.alive} vorhanden · ${r.unreachable} nicht mehr vorhanden`
    );
    // Without this line the numbers do not add up and the report looks like
    // it is contradicting itself between runs: the second pass only looks at
    // a batch at a time, and everything past it has no verdict either way.
    const noVerdict = r.checked - r.alive - r.unreachable;
    if (noVerdict > 0) {
      lines.push(`· ${noVerdict} ohne Urteil (kommen im nächsten Lauf dran)`);
    }
    if (r.deleted > 0) {
      lines.push(
        `💔 ${r.deleted} ${r.deleted === 1 ? "Post ist" : "Posts sind"} nicht mehr da — markiert`
      );
    }
    // Whatever is left over was gone but could not be removed: the run hit
    // its cap, or the message still carries a live link.
    if (r.watching > 0) {
      lines.push(`↩︎ ${r.watching} folgen beim nächsten Lauf`);
    }
  }
  const text = lines.join("\n");

  const res = editing
    ? await editMessageText({ chat_id: cfg.chat_id, message_id: editing, text })
    : await sendMessage({
        chat_id: cfg.chat_id,
        message_thread_id: cfg.talk_thread_id,
        text,
        disable_notification: true,
      });
  // The report is the only thing anyone sees. If it does not arrive, the run
  // looks like it never happened — which is precisely how the last two
  // failures presented themselves.
  if (!res.ok) console.error("[links] report not delivered", res.error);
}
