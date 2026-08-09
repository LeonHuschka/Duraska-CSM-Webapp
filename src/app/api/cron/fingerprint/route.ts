import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fingerprintPending } from "@/lib/fingerprint-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run the fingerprint pass on demand. The scheduled pass rides along with
 * the pipeline check; this exists so the one-off backfill can be driven by
 * hand without anyone handling a secret.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  let authed =
    req.headers.get("x-vercel-cron") !== null ||
    (!!secret && new URL(req.url).searchParams.get("secret") === secret);
  if (!authed) {
    const session = await createClient();
    const { data: user } = await session.auth.getUser();
    if (user.user) {
      const { data: role } = await session
        .from("persona_members")
        .select("role")
        .eq("user_id", user.user.id)
        .in("role", ["owner", "manager"])
        .limit(1)
        .maybeSingle();
      authed = !!role;
    }
  }
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  return NextResponse.json(await fingerprintPending(Date.now() + 45_000));
}
