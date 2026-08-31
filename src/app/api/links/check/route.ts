import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLinkCheck } from "@/lib/link-check-job";

export const dynamic = "force-dynamic";
// Hobby allows 300 seconds, not the 60 I had assumed from an older limit —
// and that assumption is what forced the second scraper into a deadline it
// kept missing by ten seconds. It needs 31 to 56; now it simply has room.
export const maxDuration = 300;

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
  const force = url.searchParams.get("force") === "1";

  const results = await runLinkCheck(createAdminClient(), {
    personaId,
    trigger,
    force,
  });
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
