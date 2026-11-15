import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishDue } from "@/lib/auto-publish";
import { fillDrafts, sendDue } from "@/lib/fansly-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The planner's timer, called every five minutes by the database itself
 * (pg_cron, migration 00062) with a secret only the database and the app
 * know. Publishes whatever is due. Also the Fansly calendar's clock:
 * approved posts go to the VA the day before, and once an hour the free
 * times of the next two weeks are filled with drafts.
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "publish_cron").maybeSingle();
  if (!secret?.value || req.headers.get("x-publish-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const deadline = Date.now() + 270_000;
  const results = await publishDue(admin, { deadline });
  const fansly = await sendDue(deadline).catch((err) => [{ id: "-", error: String(err) }]);
  // Once an hour is enough to fill the calendar: new cuts, new free times.
  let filled: Record<string, unknown> | null = null;
  if (new Date().getUTCMinutes() < 5 && Date.now() < deadline - 120_000) {
    const { data: cfgs } = await admin.from("telegram_config").select("persona_id").not("fansly_thread_id", "is", null);
    filled = {};
    for (const c of cfgs ?? []) {
      filled[c.persona_id] = await fillDrafts(admin, c.persona_id).catch((err) => String(err));
    }
  }
  return NextResponse.json({ ok: true, results, fansly, filled });
}
