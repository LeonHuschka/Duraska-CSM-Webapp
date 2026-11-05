import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { postShootList, refreshShootList } from "@/lib/shoot-list";
import { setMyCommands } from "@/lib/telegram";

/**
 * Today's SHOOTING list, drawn again in its message — for when the way it
 * reads changed after it went out. Opened in a browser signed in as an
 * owner or manager. `?new=1` picks the reels anew and posts a fresh
 * message instead, like `/list` in the topic. `?commands=1` publishes the
 * bot's "/" menu.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const personaId = await getActivePersonaId();
  if (!personaId) return NextResponse.json({ error: "no persona" }, { status: 400 });

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const allowed = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  if (!allowed) return NextResponse.json({ error: "owners and managers only" }, { status: 403 });

  const admin = createAdminClient();
  if (new URL(req.url).searchParams.get("commands") === "1") {
    const res = await setMyCommands();
    return NextResponse.json({ ok: res.ok, error: res.error ?? null });
  }
  if (new URL(req.url).searchParams.get("new") === "1") {
    return NextResponse.json({ ok: true, list: await postShootList(admin, personaId, true) });
  }
  await refreshShootList(admin, personaId);
  return NextResponse.json({ ok: true, list: "redrawn" });
}
