import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { deleteMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** The two winners the young-reel median made up on 02.11. */
const WRONG = ["DeULQi6z9bs", "DeUf_Ebz6_s"];

/** One-off: delete their winner posts, keep the rows so they never come back. Owners only. */
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

  const admin = createAdminClient();
  const { data: cfg } = await admin.from("telegram_config").select("chat_id").eq("persona_id", personaId).maybeSingle();
  if (!cfg?.chat_id) return NextResponse.json({ error: "no chat" });
  const { data: rows } = await admin
    .from("winners")
    .select("id, shortcode, message_id")
    .eq("persona_id", personaId)
    .in("shortcode", WRONG);
  const out: Record<string, unknown> = {};
  for (const w of rows ?? []) {
    if (w.message_id == null) {
      out[w.shortcode] = "no message";
      continue;
    }
    const res = await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(w.message_id) });
    if (res.ok) await admin.from("winners").update({ message_id: null }).eq("id", w.id);
    out[w.shortcode] = res;
  }
  return NextResponse.json(out);
}
