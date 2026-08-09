import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAlert, type Cfg } from "@/lib/pipeline-alert";
import { dailyDemand } from "@/lib/demand";
import {
  checkInstagramAlive,
  deleteMessage,
  sendMessage,
  setMessageReaction,
  REACTION,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const secret = process.env.CRON_SECRET;
  const authed =
    isVercelCron ||
    (secret && new URL(req.url).searchParams.get("secret") === secret);
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = createAdminClient();
  const summary: Record<string, unknown> = {};
  const deadline = Date.now() + CHECK_BUDGET_MS;

  const { data: configs } = await supabase
    .from("telegram_config")
    .select(
      "persona_id, chat_id, talk_thread_id, model_username, va_username, manager_username, min_ready_to_post, min_open_links, max_unedited, last_alert_at"
    );

  for (const cfg of configs ?? []) {
    summary[cfg.persona_id] = await runForPersona(supabase, cfg, deadline);
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
  const { data: links } = await supabase
    .from("content_links")
    .select("status")
    .eq("persona_id", cfg.persona_id);
  const openLinks = (links ?? []).filter((l) => l.status === "open").length;
  const shotNotUploaded = (links ?? []).filter((l) => l.status === "shot").length;

  const { data: reqs } = await supabase
    .from("content_requests")
    .select("status")
    .eq("persona_id", cfg.persona_id);
  const unedited = (reqs ?? []).filter((r) => r.status === "shooted").length;
  const readyToPost = (reqs ?? []).filter((r) => r.status === "edited").length;

  // What the accounts actually consume, summed from their own rates.
  const { perDay } = await dailyDemand(supabase, cfg.persona_id);
  const runwayDays = Math.floor(readyToPost / Math.max(1, perDay));

  const alert = buildAlert({
    cfg,
    openLinks,
    shotNotUploaded,
    unedited,
    readyToPost,
    runwayDays,
  });

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
    openLinks,
    shotNotUploaded,
    unedited,
    readyToPost,
    runwayDays,
    alerted: !!alert && !quiet,
  };
}
