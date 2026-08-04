import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMe, getWebhookInfo } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Setup diagnostics, guarded by CRON_SECRET.
 *
 * Answers "why isn't the bot doing anything" without anyone having to open
 * the hosting dashboard or read a secret back out of it. Reports only
 * derived facts — the bot's own username, whether a webhook is registered,
 * Telegram's last delivery error — never the token itself.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = new URL(req.url).searchParams.get("secret");
  if (!secret || given !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const env = {
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    CRON_SECRET: true,
  };

  // Is the configured token a real bot?
  const me = await getMe();
  const bot = me.ok
    ? { valid: true, username: (me.result as { username?: string })?.username }
    : { valid: false, error: me.error };

  // Does Telegram have somewhere to deliver to?
  const hook = await getWebhookInfo();
  const webhook = hook.ok
    ? (() => {
        const r = hook.result as Record<string, unknown>;
        return {
          url: r.url || null,
          pending: r.pending_update_count ?? 0,
          last_error: r.last_error_message ?? null,
          allowed_updates: r.allowed_updates ?? null,
        };
      })()
    : { error: hook.error };

  // Is the group wired up, and is anything flowing?
  let config: unknown = null;
  let counts: unknown = null;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("telegram_config")
      .select("persona_id, chat_id, requests_thread_id, talk_thread_id");
    config = data;
    const { data: links } = await supabase.from("content_links").select("status");
    const tally: Record<string, number> = {};
    for (const l of links ?? []) tally[l.status] = (tally[l.status] ?? 0) + 1;
    counts = { links_total: links?.length ?? 0, by_status: tally };
  } catch (err) {
    config = { error: err instanceof Error ? err.message : "db unreachable" };
  }

  return NextResponse.json({ ok: true, env, bot, webhook, config, counts });
}
