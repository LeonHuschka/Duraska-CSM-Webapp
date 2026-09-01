import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  checkPostsPaid,
  CONTROL_SHORTCODE,
  CONTROL_URL,
  harvestRecentRuns,
  hasSession,
  monthlySpend,
  PAID_BATCH,
  RUN_DEADLINE_MS,
  SPEND_CEILING_SHARE,
} from "@/lib/apify";
import { checkPostsDirect } from "@/lib/instagram-probe";
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
 * Links looked at per run, oldest-checked first.
 *
 * The cap was forty while the first pass was paid per link. It is free now,
 * so the whole backlog is swept every run again and a post that dies is
 * noticed the next day rather than three days later.
 */
const MAX_LINKS = 150;

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

/**
 * The backstop: however quiet things look, no link goes longer than this
 * without somebody actually answering for it.
 *
 * Five days against a thirty-day lifetime, so a post that dies while the
 * free probe is being turned away is still caught with three weeks of its
 * life left. It also bounds the worst case on its own — sixty-five open
 * links divided over five days is thirteen a run, about three cents.
 */
const PAID_AFTER_DAYS = 5;

/**
 * How far back to pick up scraper runs we paid for but never read.
 *
 * Long enough to catch yesterday's run at the same hour, short enough that
 * nothing stale is passed off as today's news. Apify keeps datasets seven
 * days; a week-old "still there" is not evidence about this morning.
 */
const HARVEST_WINDOW_MS = 26 * 3600_000;

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
  /** How many links each pass had to answer — the cost, itemised. */
  harvested: number;
  freeAnswered: number;
  paidAsked: number;
  /** Apify credit used this month, so the cost is never a surprise. */
  spentUsd: number | null;
  budgetUsd: number | null;
  trusted: boolean;
  note: string | null;
  /** Went wrong, but does not make the verdicts we hold any less true. */
  warn: string | null;
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
    harvested: 0,
    freeAnswered: 0,
    paidAsked: 0,
    spentUsd: null,
    budgetUsd: null,
    trusted: true,
    note: null,
    warn: null,
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
      "id, url, url_key, chat_id, message_id, link_ok, hidden_confirmed, checked_at, unreachable_since, unreachable_runs"
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

  // ── Pass zero: the answers already bought ──
  //
  // Abandoning the HTTP request does not cancel the scraper run; it finishes
  // and bills either way, and its dataset keeps for a week. Reading it back
  // costs nothing, so it happens before a cent is spent. Without this, a run
  // that times out at 231 seconds is simply purchased again tomorrow — which
  // is how the same 82 answers were paid for twice.
  const harvest = await harvestRecentRuns(HARVEST_WINDOW_MS);
  const bought = harvest.states;
  base.harvested = links.filter((l) => bought.has(l.url_key)).length;

  // ── First pass: free, straight to Instagram ──
  //
  // /diag showed the host is answered again, so this is tried before any
  // money is spent. It is not reliable at volume — a hundred links at once
  // got every one of them refused minutes after a single one worked, and one
  // September run had all 83 turned away — so it asks gently, keeps whatever
  // it gets, and hands the rest along. Its failures are not verdicts and
  // cost nothing.
  const {
    states,
    asked: probed,
    error,
  } = await checkPostsDirect([
    ...links.filter((l) => !bought.has(l.url_key)).map((l) => l.url),
    ...(bought.has(CONTROL_SHORTCODE) ? [] : [CONTROL_URL]),
  ]);
  base.freeAnswered = states.size;

  // Which links can be seen without paying anybody. A link the scraper calls
  // alive that this set does not contain is age-gated rather than public,
  // and that is worth remembering: the free probe will never see it, so
  // without the marker it would fall through to the paid pass every single
  // day for the rest of its month.
  //
  // Only links the probe actually reached count either way. It gives up
  // after eight refusals in a row, and on the day this was written it was
  // turned away from all 83 — reading that silence as "age-gated" would have
  // written the marker onto the entire backlog and quietly retired it from
  // ever being checked again.
  const publiclyVisible = new Set(
    links.filter((l) => states.get(l.url_key) === "alive").map((l) => l.url_key)
  );

  // ── Second pass: the only one that costs money ──
  //
  // At $0.0027 a link the bill is decided entirely by how often a link is
  // bought an answer for, so this is where that is decided.
  //
  // The free probe's silence comes in two kinds and they mean opposite
  // things. "I looked and the post was not there" is news: something changed
  // today, and it is worth the third of a cent to find out what. "I never
  // got that far" is not news at all — it is our vantage point failing, and
  // the post was almost certainly fine. Paying for the second kind is what
  // made a bad afternoon at Instagram cost twenty cents: the probe was
  // turned away from all 83 links and every one of them fell through to the
  // scraper.
  //
  // So the second kind waits for the probe to have a better day, with a
  // backstop for anything nobody has had an answer about in a long time —
  // or ever, which is how a newly posted link gets looked at the same day.
  // All of which is an economy, and every economy here is a response to the
  // price of an answer. With a session that price is $0.00018 — a whole
  // sweep of every open link costs about a cent — and rationing it would be
  // care spent in the wrong place, paid for in dead links sitting in the
  // topic for days. So the rationing is exactly as strict as the scraper is
  // expensive, and no stricter.
  const loggedIn = hasSession();
  const paidCutoff = new Date(now - PAID_AFTER_DAYS * 86_400_000).toISOString();
  const unsure = links.filter((l) => {
    if (bought.has(l.url_key)) return false;
    if (states.get(l.url_key) === "alive") return false;
    // Age-gated. Logged out, neither the probe nor the scraper will ever see
    // these, so buying the same "still there behind a gate" every day for a
    // month is money for nothing and they leave by the age rule instead.
    // Logged in they are ordinary posts, and the blind spot goes with them.
    if (!loggedIn && l.hidden_confirmed) return false;
    if (loggedIn) return true;
    if (probed.has(l.url_key)) return true;
    return !l.checked_at || l.checked_at < paidCutoff;
  });
  // Nothing else in this job can run the credit down, so the ceiling is
  // checked here and nowhere else. Over it, the run keeps the free probe and
  // the age rule — which cost nothing at all — and simply stops being able
  // to tell deleted from age-gated until the month turns over.
  const before = await monthlySpend();
  const overBudget =
    before !== null && before.limit > 0 && before.used / before.limit > SPEND_CEILING_SHARE;

  // The cap is a brake against a rule gone wrong, and how hard it has to
  // bite depends on what a mistake costs: seven cents logged out, a third of
  // a cent logged in.
  const cap = loggedIn ? MAX_LINKS : PAID_BATCH;
  const paidUrls = overBudget ? [] : unsure.slice(0, cap).map((l) => l.url);
  base.paidAsked = paidUrls.length;
  const fresh = await checkPostsPaid(
    paidUrls.length > 0 ? [...paidUrls, CONTROL_URL] : [],
    // Whatever is left of the run's budget. Running out here costs a day;
    // running out after the marking but before the report leaves nobody
    // knowing what happened.
    now + RUN_DEADLINE_MS - Date.now()
  );

  // Read the bill after the run that ran it up, not before. The report used
  // to quote a figure taken minutes earlier and was short by exactly the
  // cost of the run it was reporting on.
  const spend = (paidUrls.length > 0 ? await monthlySpend() : null) ?? before;
  base.spentUsd = spend?.used ?? null;
  base.budgetUsd = spend?.limit ?? null;

  // Only the paid pass may condemn anything; the free probe never says
  // "gone", so it has nothing here to overrule. Bought verdicts go on first,
  // this run's over the top of them.
  bought.forEach((state, code) => states.set(code, state));
  fresh.states.forEach((state, code) => states.set(code, state));

  if (error) {
    await stamp(supabase, cfg.persona_id);
    const failed = { ...base, trusted: false, note: error };
    await report(cfg, failed, trigger, notice);
    return failed;
  }

  // Something went wrong that is worth saying out loud but does not make the
  // verdicts we do hold any less true. A scraper that refused to answer this
  // run tells us nothing about the answers bought yesterday, and treating it
  // as though it did is what turned a run holding 82 good verdicts into "82
  // geprüft · nichts markiert".
  const warnings: string[] = [];
  if (fresh.error) warnings.push(fresh.error);
  if (paidUrls.length > 0 && fresh.states.size === 0) {
    warnings.push("der Scraper hat auf nichts geantwortet");
  }
  if (overBudget && unsure.length > 0) {
    warnings.push(
      `Apify-Guthaben zu ${Math.round(((spend?.used ?? 0) / (spend?.limit || 1)) * 100)}% verbraucht — der bezahlte Durchgang bleibt aus`
    );
  }

  // ── Is this run worth believing? ──
  //
  // Every way this can go wrong looks the same from the inside: everything
  // reads as gone. So each of these has to hold before a single message is
  // touched.
  //
  // They are only asked when the run actually wants to mark something. A
  // quiet run that found nothing dead has nothing to be wrong about, and
  // warning about it reads as breakage where there is none.
  const answered = links.filter((l) => states.has(l.url_key));
  const missing = answered.filter((l) => states.get(l.url_key) === "unreachable");
  const reasons: string[] = [];

  if (missing.length > 0) {
    // "Not answered" and "answered as alive" both block marking, but they
    // are different problems and saying which saves an hour of looking in
    // the wrong place — as it did when a rejected batch was reported as a
    // live control.
    const control = states.get(CONTROL_SHORTCODE);
    if (control === "alive") {
      reasons.push("der Kontrollposten kam als vorhanden zurück");
    } else if (control !== "unreachable") {
      reasons.push("der Kontrollposten wurde nicht beantwortet");
    }
    if (!answered.some((l) => states.get(l.url_key) === "alive")) {
      // Logged in, this has one overwhelmingly likely cause, and naming it
      // saves someone reading scraper logs to find out that a cookie has
      // expired. Nothing is marked either way — the run simply stops.
      reasons.push(
        loggedIn
          ? "kein einziger Link kam als vorhanden zurück — vermutlich ist das Instagram-Cookie abgelaufen"
          : "kein einziger Link kam als vorhanden zurück"
      );
    }
    // Links that were fine yesterday are the honest control: a handful may
    // genuinely have died overnight, half of them cannot have.
    const wereAlive = answered.filter((l) => l.link_ok === true);
    const stillAlive = wereAlive.filter((l) => states.get(l.url_key) === "alive");
    if (wereAlive.length >= 4 && stillAlive.length < wereAlive.length / 2) {
      reasons.push(
        `${wereAlive.length - stillAlive.length} von ${wereAlive.length} zuletzt erreichbaren Links sind auf einmal weg`
      );
    }
    // And the share itself: see MAX_UNREACHABLE_SHARE.
    const share = missing.length / answered.length;
    if (answered.length >= 10 && share > MAX_UNREACHABLE_SHARE) {
      reasons.push(
        `${missing.length} von ${answered.length} Links (${Math.round(share * 100)}%) sind von hier aus nicht erreichbar — das ist der Blickwinkel, nicht die Posts`
      );
    }
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
          // Left exactly as it was when the probe never reached this link:
          // no evidence, no change.
          hidden_confirmed: probed.has(l.url_key)
            ? !publiclyVisible.has(l.url_key)
            : l.hidden_confirmed,
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
    warn: warnings.length > 0 ? warnings.join("; ") : null,
  };
  // The detail the report no longer carries. Worth keeping, because the cost
  // argument rests entirely on these three numbers: the paid one should be
  // small, and it should be small because the other two are doing the work.
  console.log(
    `[links] geerbt ${result.harvested} · gratis ${result.freeAnswered} · bezahlt ${result.paidAsked} → ` +
      `${result.alive} vorhanden, ${result.unreachable} weg, ${result.deleted} markiert, ` +
      `${result.expired} abgelaufen, ${result.refused} verweigert`
  );
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
      // "message to react not found" means somebody already removed it by
      // hand, which is the outcome the mark was asking for. Recording that
      // stops the link being retried, and failing, every run forever.
      if (/not found/i.test(res.error ?? "")) {
        await supabase
          .from("content_links")
          .update({ status: "skipped", updated_at: new Date().toISOString() })
          .in("id", rows.map((r) => r.id));
        deleted++;
        continue;
      }
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
      // Already gone from the chat — the mark has nothing left to point at,
      // and the link should stop coming back round.
      if (/not found/i.test(res.error ?? "")) {
        await supabase
          .from("content_links")
          .update({ status: "dead", updated_at: new Date().toISOString() })
          .in("id", rows.map((r) => r.id));
        deleted++;
        continue;
      }
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

  // Two outcomes, because two are all there are: a link either ends the run
  // with a 💔 on its message or it does not. Anything finer — which pass
  // settled it, what the scraper could not see — belongs in the logs, not
  // in a line somebody reads once a day. The earlier report carried a
  // "these follow next run" figure that read like a queue being worked off
  // and was really just a snapshot of that run, which made two consecutive
  // reports look like they contradicted each other.
  const marked = r.deleted + r.expired;

  if (!r.trusted) {
    lines.push(`${r.checked} geprüft · nichts markiert`);
    lines.push(`⚠️ ${r.note}`);
  } else if (r.checked === 0 && marked === 0) {
    lines.push("Nichts zu prüfen.");
  } else {
    lines.push(
      `${r.checked} geprüft · ${r.checked - marked} sind ✅ · ${marked} sind ❌`
    );
    if (marked > 0) lines.push(`↩︎ ${marked} reacted as dead`);
  }

  if (r.warn) {
    lines.push(`⚠️ ${r.warn}`);
  }
  if (r.refused > 0) {
    lines.push(`⚠️ ${r.refused} konnten nicht markiert werden`);
  }
  if (r.spentUsd != null && r.budgetUsd) {
    lines.push(
      `💳 Apify: $${r.spentUsd.toFixed(2)} von $${r.budgetUsd.toFixed(2)} diesen Monat`
    );
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
