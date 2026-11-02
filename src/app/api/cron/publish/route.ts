import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishDue } from "@/lib/auto-publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The planner's timer, called every five minutes by the database itself
 * (pg_cron, migration 00062) with a secret only the database and the app
 * know. Publishes whatever is due.
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "publish_cron").maybeSingle();
  if (!secret?.value || req.headers.get("x-publish-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const results = await publishDue(admin, { deadline: Date.now() + 270_000 });
  return NextResponse.json({ ok: true, results });
}
