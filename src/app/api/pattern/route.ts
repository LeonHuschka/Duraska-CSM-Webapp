import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { berlinDay } from "@/lib/berlin-day";
import { patternAccounts, runPatternAnalysis, weekBefore } from "@/lib/pattern-analysis";
import { sendMessage } from "@/lib/telegram";

/**
 * The weekly pattern analysis, one account per invocation.
 *
 *   ?account=<id>  one account, answered when it is done — for trying it
 *   ?all=1         every posting account, one after the other: each run
 *                  hands the rest of the list to a fresh invocation, so the
 *                  topic gets one account's messages at a time and no run
 *                  comes near the time limit
 *   &end=YYYY-MM-DD  the last day of the week (default: yesterday, Berlin)
 *   &send=0        analyse and store, post nothing
 *
 * The Sunday cron starts `all`. Signed in as an owner, or with the cron
 * secret.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DAY = 86_400_000;

async function allowed(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = req.headers.get("x-link-check-secret") ?? url.searchParams.get("secret");
  if (secret && given === secret) return true;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle();
  return profile?.global_role === "owner";
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("end") ?? "")
    ? url.searchParams.get("end")!
    : berlinDay(new Date(Date.now() - DAY));
  const send = url.searchParams.get("send") !== "0";
  const supabase = createAdminClient();

  const one = url.searchParams.get("account");
  if (one) {
    try {
      return NextResponse.json({ ok: true, result: await runPatternAnalysis(supabase, one, { end, send }) });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
    }
  }

  const queued = url.searchParams.get("queue");
  const queue = queued ? queued.split(",").filter(Boolean) : url.searchParams.get("all") === "1" ? await patternAccounts(supabase) : [];
  if (queue.length === 0) return NextResponse.json({ ok: true, done: true });

  // The start of a run says what is coming.
  if (!queued && send) {
    const { data: cfgs } = await supabase.from("telegram_config").select("chat_id, pattern_thread_id");
    const { from, to } = weekBefore(end);
    const range = `${from.slice(8, 10)}.${from.slice(5, 7)}. – ${to.slice(8, 10)}.${to.slice(5, 7)}.`;
    for (const c of cfgs ?? []) {
      if (!c.chat_id || !c.pattern_thread_id) continue;
      await sendMessage({
        chat_id: c.chat_id,
        message_thread_id: c.pattern_thread_id,
        text: `🗓 <b>Pattern analysis · ${range}</b>\nWhy the week's best reels worked, account by account — and what to shoot next.`,
      });
    }
  }

  const [first, ...rest] = queue;
  waitUntil(
    (async () => {
      try {
        const r = await runPatternAnalysis(supabase, first, { end, send });
        console.log("[pattern]", JSON.stringify(r));
      } catch (err) {
        console.error("[pattern]", first, err instanceof Error ? err.message : err);
      }
      if (rest.length === 0 || !process.env.CRON_SECRET) return;
      const next = new URL("/api/pattern", url.origin);
      next.searchParams.set("queue", rest.join(","));
      next.searchParams.set("end", end);
      if (!send) next.searchParams.set("send", "0");
      // The next invocation answers at once and works on in its own time.
      await fetch(next, { method: "POST", headers: { "x-link-check-secret": process.env.CRON_SECRET } }).catch((err) =>
        console.error("[pattern] next account not started", err)
      );
    })()
  );
  return NextResponse.json({ ok: true, started: first, queued: rest.length }, { status: 202 });
}
