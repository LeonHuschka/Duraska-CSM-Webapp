import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { scrapeAccounts } from "@/lib/account-scrape";

/**
 * Read every posting account now, as the person who is logged in.
 *
 * The same job the 7:17 cron runs and the "Scrape now" button starts, on a
 * URL: open it in a browser that is signed in as an owner or manager and
 * it runs. Useful when the button is out of reach — a phone, a bookmark,
 * an automation that can hold a session but not click.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const personaId = await getActivePersonaId();
  if (!personaId) return NextResponse.json({ error: "no persona" }, { status: 400 });

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase
      .from("persona_members")
      .select("role")
      .eq("persona_id", personaId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const allowed =
    profile?.global_role === "owner" ||
    membership?.role === "owner" ||
    membership?.role === "manager";
  if (!allowed) return NextResponse.json({ error: "owners and managers only" }, { status: 403 });

  const summary = await scrapeAccounts(createAdminClient(), personaId);
  return NextResponse.json({ ok: true, summary });
}
