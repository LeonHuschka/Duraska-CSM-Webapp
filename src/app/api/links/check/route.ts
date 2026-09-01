import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { undoAllMarks } from "@/lib/link-cleanup";

/**
 * Take every 💔 back off the inspo links.
 *
 * This endpoint used to run the availability check. That is gone — see
 * link-cleanup.ts — and the route is kept only so the existing bot command
 * and secret still reach something. It does one thing and it is safe to run
 * as often as you like.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret =
    url.searchParams.get("secret") ?? req.headers.get("x-link-check-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const persona = url.searchParams.get("persona") ?? undefined;
  const results = await undoAllMarks(createAdminClient(), { personaId: persona });
  return NextResponse.json({ ok: true, results });
}
