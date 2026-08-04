import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily report every run; weekly sum-up additionally on Mondays.
 *
 * Numbers come from the screenshots VAs post — so a metric only moves when
 * someone actually sent a screenshot. The report says how many it saw, so a
 * quiet day reads as "no data" rather than "no growth".
 */

export async function GET(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const authed =
    isVercelCron || (secret && url.searchParams.get("secret") === secret);
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  const force = url.searchParams.get("force"); // "daily" | "weekly" for testing
  const supabase = createAdminClient();
  const out: Record<string, unknown> = {};

  const { data: configs } = await supabase
    .from("telegram_config")
    .select(
      "persona_id, chat_id, reports_thread_id, talk_thread_id, last_daily_report_at, last_weekly_report_at"
    );

  for (const cfg of configs ?? []) {
    if (!cfg.chat_id) continue;
    const thread = cfg.reports_thread_id ?? cfg.talk_thread_id ?? null;

    const daily = await buildReport(supabase, cfg.persona_id, 1);
    if (daily && (force === "daily" || !sentToday(cfg.last_daily_report_at))) {
      await sendMessage({ chat_id: cfg.chat_id, message_thread_id: thread, text: daily });
      await supabase
        .from("telegram_config")
        .update({ last_daily_report_at: new Date().toISOString() })
        .eq("persona_id", cfg.persona_id);
    }

    const isMonday = new Date().getUTCDay() === 1;
    if (force === "weekly" || (isMonday && !sentThisWeek(cfg.last_weekly_report_at))) {
      const weekly = await buildReport(supabase, cfg.persona_id, 7);
      if (weekly) {
        await sendMessage({
          chat_id: cfg.chat_id,
          message_thread_id: thread,
          text: weekly,
        });
        await supabase
          .from("telegram_config")
          .update({ last_weekly_report_at: new Date().toISOString() })
          .eq("persona_id", cfg.persona_id);
      }
    }
    out[cfg.persona_id] = { daily: !!daily };
  }

  return NextResponse.json({ ok: true, out });
}

function sentToday(iso: string | null) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}
function sentThisWeek(iso: string | null) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 6 * 24 * 60 * 60 * 1000;
}

const nf = (n: number) => n.toLocaleString("en-US");
function delta(now: number | null, before: number | null): string {
  if (now == null || before == null) return "";
  const d = now - before;
  if (d === 0) return " (±0)";
  return d > 0 ? ` (+${nf(d)})` : ` (${nf(d)})`;
}

async function buildReport(
  supabase: ReturnType<typeof createAdminClient>,
  personaId: string,
  days: number
): Promise<string | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const prevSince = new Date(
    Date.now() - 2 * days * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, handle, platform")
    .eq("persona_id", personaId)
    .neq("status", "dead");
  if (!accounts || accounts.length === 0) return null;

  const { data: metrics } = await supabase
    .from("account_metrics")
    .select(
      "account_id, captured_at, followers, views, reach, likes, comments, profile_visits, metric_kind"
    )
    .eq("persona_id", personaId)
    .gte("captured_at", prevSince)
    .order("captured_at", { ascending: true });

  // How much did we post in the window (from our own pipeline, not screenshots)
  const { count: postedCount } = await supabase
    .from("schedule_slots")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "posted")
    .gte("posted_at", since);

  const label = days === 1 ? "Daily report" : "Weekly sum-up";
  const lines: string[] = [`<b>📊 ${label}</b>`];
  let sawAnything = false;

  for (const acc of accounts) {
    const mine = (metrics ?? []).filter((m) => m.account_id === acc.id);
    const current = mine.filter((m) => m.captured_at >= since);
    const previous = mine.filter((m) => m.captured_at < since);
    if (current.length === 0) continue;
    sawAnything = true;

    // Latest profile snapshot in each window for follower deltas.
    const lastProfile = [...current].reverse().find((m) => m.followers != null);
    const prevProfile = [...previous].reverse().find((m) => m.followers != null);

    // Content metrics get summed across the window.
    const sum = (k: "views" | "reach" | "likes" | "comments" | "profile_visits") =>
      current.reduce((a, m) => a + (m[k] ?? 0), 0);

    const parts: string[] = [];
    if (lastProfile?.followers != null) {
      parts.push(
        `👥 ${nf(lastProfile.followers)}${delta(
          lastProfile.followers,
          prevProfile?.followers ?? null
        )} followers`
      );
    }
    const views = sum("views");
    if (views > 0) parts.push(`▶️ ${nf(views)} views`);
    const reach = sum("reach");
    if (reach > 0) parts.push(`📡 ${nf(reach)} reach`);
    const likes = sum("likes");
    if (likes > 0) parts.push(`❤️ ${nf(likes)}`);
    const visits = sum("profile_visits");
    if (visits > 0) parts.push(`👀 ${nf(visits)} profile visits`);

    lines.push(
      ``,
      `<b>@${acc.handle}</b> <i>(${acc.platform})</i>`,
      parts.length ? parts.join(" · ") : "no numbers read",
      `<i>${current.length} screenshot${current.length === 1 ? "" : "s"}</i>`
    );
  }

  if (!sawAnything) return null;

  lines.push(``, `📤 ${postedCount ?? 0} posts marked in the app this period.`);
  return lines.join("\n");
}
