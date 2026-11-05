import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { pipelineCounts } from "@/lib/pipeline-counts";
import { buildAlert, type Cfg } from "@/lib/pipeline-alert";
import { fingerprintPending } from "@/lib/fingerprint-job";
import { scrapeAccounts } from "@/lib/account-scrape";
import { announceWinners } from "@/lib/winners";
import { sendPostingFocus } from "@/lib/posting-focus";
import { postShootList } from "@/lib/shoot-list";
import { refreshIgTokens } from "@/lib/auto-publish";
import { fetchInspoVideo, retryableVideoLinks } from "@/lib/inspo-video";
import {
  checkInstagramAlive,
  deleteMessage,
  sendMessage,
  setMessageReaction,
  setMyCommands,
  REACTION,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
// Hobby allows 300. The account scrape needs up to two and a half minutes
// when Facebook is slow, and it runs alongside everything else here because
// the plan's two cron slots are both taken.
export const maxDuration = 300;

/**
 * Off since 2026-09-06. The screenshots are read by the platform scrape
 * instead — see account-scrape.ts — so the fingerprints that let a
 * screenshot tile be recognised are no longer needed. The VAs can keep
 * sending screenshots; nothing is read off them.
 */
const SCREENSHOT_EXTRACTION_ENABLED = false;

/**
 * Scheduled job: verify inspo links are still live, and warn the group when
 * the content pipeline is about to run dry.
 *
 * On deleting dead links: a link that is provably gone has its Telegram
 * message deleted, so the topic only ever shows work that still exists.
 * "Provably" is doing real work there — Instagram blocks datacenter IPs and
 * frequently answers with a login wall or a 429 instead of a 404, and
 * treating that as death would delete perfectly good links. So only an
 * explicit 404 or a removed-post page counts; anything ambiguous leaves the
 * link untouched to be re-checked on the next run.
 */

// Turned off on 2026-08-04. Instagram answers this server with the same
// login wall for a live reel and a deleted one, so the check produces no
// verdict at all — and while a looser rule was in place it would have
// deleted 52 valid links. Dead links are retired by a 💔 reaction until
// the check runs from an IP Instagram answers. The alert below is
// unaffected and keeps running.
const LINK_CHECK_ENABLED = false;

// Every open link gets checked on every run, not a slice of them. Instagram
// answers in about a second, so the run is bounded by fan-out plus a wall
// clock the function can't outlive — whatever is left keeps its old
// checked_at and therefore sorts to the front of the next run.
const CHECK_CONCURRENCY = 8;
const CHECK_BUDGET_MS = 40_000;

export async function GET(req: Request) {
  // Vercel Cron sends this header; also allow a manual secret for testing.
  // Vercel's scheduler sends "Authorization: Bearer <CRON_SECRET>". The
  // x-vercel-cron header it also sends is not proof of anything — any
  // client can set it, and until 2026-09-06 that was enough to run this.
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const authed =
    !!secret &&
    (bearer === secret || new URL(req.url).searchParams.get("secret") === secret);
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = createAdminClient();
  const summary: Record<string, unknown> = {};
  const deadline = Date.now() + CHECK_BUDGET_MS;
  // "?only=scrape" runs the account scrape and nothing else — for trying it
  // by hand without also firing the pipeline alert.
  const only = new URL(req.url).searchParams.get("only");

  const { data: configs } = await supabase
    .from("telegram_config")
    .select(
      "persona_id, chat_id, talk_thread_id, model_username, va_username, manager_username, min_ready_to_post, min_open_links, max_unedited, last_alert_at"
    );

  // The daily read of every posting account, all personas side by side. It
  // goes first because it is the slowest thing here and must not be cut off
  // by whatever the checks below take.
  const scrape = await Promise.all(
    (configs ?? []).map(async (cfg) => [cfg.persona_id, await scrapeAccounts(supabase, cfg.persona_id)] as const)
  );
  summary.scrape = Object.fromEntries(scrape);
  // With today's plays in, the reels that took off — reported once each.
  const winners = await Promise.all(
    (configs ?? []).map(async (cfg) => [cfg.persona_id, await announceWinners(supabase, cfg.persona_id)] as const)
  );
  summary.winners = Object.fromEntries(winners);
  // Inspo reels that could not be fetched when they were posted — most
  // often Apify out of its monthly budget — get another go every morning.
  const videos = await Promise.all(
    (configs ?? []).map(async (cfg) => {
      const results = [];
      for (const id of await retryableVideoLinks(supabase, cfg.persona_id)) {
        results.push(await fetchInspoVideo(supabase, id, null, true));
      }
      return [cfg.persona_id, results] as const;
    })
  );
  summary.videos = Object.fromEntries(videos);
  // Sundays: the week's pattern analysis, on this morning's numbers. It
  // runs account by account in invocations of its own (api/pattern).
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short" }).format(new Date());
  if (weekday === "Sun" && only !== "scrape" && secret) {
    waitUntil(
      fetch(new URL("/api/pattern?all=1", req.url), { method: "POST", headers: { "x-link-check-secret": secret } })
        .then((res) => console.log("[cron] pattern analysis started", res.status))
        .catch((err) => console.error("[cron] pattern analysis not started", err))
    );
    // And Analysis: newly mature winners, losers and controls watched, everything counted again.
    waitUntil(
      fetch(new URL("/api/analysis?all=1", req.url), { method: "POST", headers: { "x-link-check-secret": secret } })
        .then((res) => console.log("[cron] analysis started", res.status))
        .catch((err) => console.error("[cron] analysis not started", err))
    );
    summary.pattern = "started";
  }
  if (only === "scrape") return NextResponse.json({ ok: true, summary });

  // Each account's topic: what did best lately and what to post because of it.
  const focus = await Promise.all(
    (configs ?? []).map(async (cfg) => [cfg.persona_id, await sendPostingFocus(supabase, cfg.persona_id)] as const)
  );
  summary.focus = Object.fromEntries(focus);
  // SHOOTING: the day's reels to shoot, yesterday's leftovers first.
  const shoot = await Promise.all(
    (configs ?? []).map(async (cfg) => [cfg.persona_id, await postShootList(supabase, cfg.persona_id)] as const)
  );
  summary.shoot = Object.fromEntries(shoot);
  // The "/" menu, kept as the code has it.
  summary.commands = (await setMyCommands()).ok;
  // Auto-posting tokens run 60 days; renewed well before.
  summary.igTokens = await refreshIgTokens(supabase).catch((err) => [String(err)]);

  for (const cfg of configs ?? []) {
    summary[cfg.persona_id] = await runForPersona(supabase, cfg, deadline);
  }

  if (SCREENSHOT_EXTRACTION_ENABLED) {
    summary.fingerprint = await fingerprintPending(
      Math.min(deadline + 10_000, Date.now() + 12_000)
    );
  }

  return NextResponse.json({ ok: true, summary });
}


async function runForPersona(
  supabase: ReturnType<typeof createAdminClient>,
  cfg: Cfg,
  deadline: number
) {
  // ── 1. Availability check on every open link ──
  const { data: toCheck } = await supabase
    .from("content_links")
    .select("id, url, chat_id, message_id")
    .eq("persona_id", cfg.persona_id)
    // Only links nobody has acted on yet. Once the model has reacted, the
    // reel is filmed and whether Instagram still hosts the original is of
    // no consequence — and deleting the message she reacted to would be
    // actively wrong.
    .eq("status", "open")
    .order("checked_at", { ascending: true, nullsFirst: true });

  const queue = LINK_CHECK_ENABLED ? [...(toCheck ?? [])] : [];
  type Verdict = {
    link: (typeof queue)[number];
    alive: boolean | null;
    reason: string;
  };
  const verdicts: Verdict[] = [];

  // Read every verdict before acting on any of them. If Instagram ever
  // starts refusing the embed endpoint too, every link reads as gone at
  // once — and deleting on that would wipe the whole topic in one run.
  async function worker() {
    for (;;) {
      if (Date.now() > deadline) return;
      const link = queue.shift();
      if (!link) return;
      const { alive, reason } = await checkInstagramAlive(link.url);
      verdicts.push({ link, alive, reason });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, worker)
  );
  // Say what was left rather than reporting a clean sweep that wasn't.
  const unchecked = queue.length;
  const checked = verdicts.length;

  const goneCount = verdicts.filter((v) => v.alive === false).length;
  // Real attrition is a few links; half the backlog dying between two runs
  // means the detector broke, not that the posts did.
  const trustworthy = checked < 3 || goneCount / checked <= 0.5;
  if (!trustworthy) {
    console.warn(
      `[cron] ${goneCount}/${checked} links read as gone — treating the check as broken, deleting nothing`
    );
  }

  let dead = 0;
  let deleted = 0;

  for (const v of verdicts) {
    // `alive === null` means the answer was unreadable. That is not
    // evidence, so the link is left as it was and re-checked next run.
    const isGone = v.alive === false && trustworthy;
    if (isGone) {
      dead++;
      const res = await deleteMessage({
        chat_id: v.link.chat_id,
        message_id: Number(v.link.message_id),
      });
      if (res.ok) {
        deleted++;
      } else {
        // Telegram refuses some deletions (too old, rights revoked).
        // Mark it instead of letting it vanish from view silently.
        await setMessageReaction({
          chat_id: v.link.chat_id,
          message_id: Number(v.link.message_id),
          emoji: REACTION.dead,
        });
      }
    }

    await supabase
      .from("content_links")
      .update({
        checked_at: new Date().toISOString(),
        link_ok: v.alive,
        ...(isGone ? { status: "dead" } : {}),
      })
      .eq("id", v.link.id);
  }

  // ── 2. Pipeline health ──
  const counts = await pipelineCounts(supabase, cfg.persona_id);

  const alert = buildAlert({ cfg, ...counts });

  // At most one alert per persona per 12h so the group doesn't get spammed.
  const lastAlert = cfg.last_alert_at ? new Date(cfg.last_alert_at).getTime() : 0;
  const quiet = Date.now() - lastAlert < 12 * 60 * 60 * 1000;

  if (alert && cfg.chat_id && !quiet) {
    const res = await sendMessage({
      chat_id: cfg.chat_id,
      message_thread_id: cfg.talk_thread_id,
      text: alert,
    });
    if (res.ok) {
      await supabase
        .from("telegram_config")
        .update({ last_alert_at: new Date().toISOString() })
        .eq("persona_id", cfg.persona_id);
    }
  }

  return {
    checked,
    unchecked,
    dead,
    deleted,
    detectorTrusted: trustworthy,
    ...counts,
    alerted: !!alert && !quiet,
  };
}
