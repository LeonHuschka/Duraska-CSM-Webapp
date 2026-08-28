import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLinkCheck } from "@/lib/link-check-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The link check, as its own request.
 *
 * Both triggers land here rather than doing the work themselves: the
 * Telegram webhook has to answer within seconds or Telegram replays the
 * update, and a scraper run plus a handful of deletions does not fit in
 * that. Its own invocation gets its own minute.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given =
    url.searchParams.get("secret") ?? req.headers.get("x-link-check-secret");
  if (!secret || given !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const personaId = url.searchParams.get("persona") ?? undefined;
  const trigger = url.searchParams.get("trigger") ?? "manuell";

  const results = await runLinkCheck(createAdminClient(), { personaId, trigger });
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
