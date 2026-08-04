import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
      "persona_id, chat_id, talk_thread_id, model_username, va_username, manager_username, posts_per_day, min_ready_to_post, min_open_links, max_unedited, last_alert_at"
    );

  for (const cfg of configs ?? []) {
    summary[cfg.persona_id] = await runForPersona(supabase, cfg, deadline);
  }

  return NextResponse.json({ ok: true, summary });
}

type Cfg = {
  persona_id: string;
  chat_id: number | null;
  talk_thread_id: number | null;
  model_username: string | null;
  va_username: string | null;
  manager_username: string | null;
  posts_per_day: number;
  min_ready_to_post: number;
  min_open_links: number;
  max_unedited: number;
  last_alert_at: string | null;
};

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

  const queue = [...(toCheck ?? [])];
  let dead = 0;
  let deleted = 0;
  let checked = 0;

  async function worker() {
    for (;;) {
      if (Date.now() > deadline) return;
      const link = queue.shift();
      if (!link) return;

      const { alive } = await checkInstagramAlive(link.url);
      checked++;
      let nextStatus: string | undefined;

      // `alive === null` means Instagram answered with a login wall, a 429
      // or something else unreadable. That is not evidence, so the link is
      // left exactly as it was and gets re-checked next run. Only a real
      // 404 or a removed-post page counts as gone.
      if (alive === false) {
        nextStatus = "dead";
        dead++;
        const res = await deleteMessage({
          chat_id: link.chat_id,
          message_id: Number(link.message_id),
        });
        if (res.ok) {
          deleted++;
        } else {
          // Telegram refuses some deletions (too old, rights revoked).
          // Mark it instead of letting it vanish from view silently.
          await setMessageReaction({
            chat_id: link.chat_id,
            message_id: Number(link.message_id),
            emoji: REACTION.dead,
          });
        }
      }

      await supabase
        .from("content_links")
        .update({
          checked_at: new Date().toISOString(),
          link_ok: alive,
          ...(nextStatus ? { status: nextStatus } : {}),
        })
        .eq("id", link.id);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, worker)
  );
  // Say what was left rather than reporting a clean sweep that wasn't.
  const unchecked = queue.length;

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

  const perDay = Math.max(1, cfg.posts_per_day);
  const runwayDays = Math.floor(readyToPost / perDay);

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
    openLinks,
    shotNotUploaded,
    unedited,
    readyToPost,
    runwayDays,
    alerted: !!alert && !quiet,
  };
}

/**
 * Work out where the pipeline is actually blocked and address the person
 * who can unblock it — a generic "we need content" helps nobody.
 */
function buildAlert(x: {
  cfg: Cfg;
  openLinks: number;
  shotNotUploaded: number;
  unedited: number;
  readyToPost: number;
  runwayDays: number;
}): string | null {
  const { cfg } = x;
  const at = (u: string | null) => (u ? `@${u.replace(/^@/, "")}` : "");
  const lines: string[] = [];

  const runwayLow = x.readyToPost < cfg.min_ready_to_post;

  // Editing is the bottleneck: plenty shot, little finished.
  if (runwayLow && x.unedited >= cfg.max_unedited) {
    lines.push(
      `✂️ <b>Editing is the bottleneck</b> ${at(cfg.va_username)}`,
      `${x.unedited} takes waiting, only ${x.readyToPost} ready to post (~${x.runwayDays}d left).`,
      `Please prioritise cutting today.`
    );
  }
  // Model is the bottleneck: links available, not enough shot.
  else if (runwayLow && x.openLinks > 0 && x.unedited < cfg.max_unedited) {
    lines.push(
      `🎬 <b>We need more raw takes</b> ${at(cfg.model_username)}`,
      `Only ${x.readyToPost} reels ready to post (~${x.runwayDays}d left) and ${x.openLinks} inspo links are still open.`,
      `Could you shoot a few today? 💪`
    );
  }
  // Inspo is the bottleneck.
  else if (x.openLinks < cfg.min_open_links) {
    lines.push(
      `🔗 <b>Inspo running low</b> ${at(cfg.manager_username)}`,
      `Only ${x.openLinks} open links left. Time to drop new references.`
    );
  }

  // Nudge for shot-but-not-uploaded, appended to whatever else we say.
  if (x.shotNotUploaded >= 3) {
    lines.push(
      ``,
      `📤 ${at(cfg.model_username)} ${x.shotNotUploaded} reels are marked as shot but not uploaded yet.`
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
