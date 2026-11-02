import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { sendPostingFocus } from "@/lib/posting-focus";

export const dynamic = "force-dynamic";

/** One-off: the posting focus messages as they would go out, sent nowhere. Owners only. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const personaId = await getActivePersonaId();
  if (!personaId) return NextResponse.json({ error: "no persona" }, { status: 400 });
  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", personaId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "owners only" }, { status: 403 });
  return NextResponse.json(await sendPostingFocus(createAdminClient(), personaId, { dryRun: true }));
}
