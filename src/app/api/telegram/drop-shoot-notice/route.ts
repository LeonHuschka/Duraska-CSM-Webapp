import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { deleteMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** One-off: delete the last "shot new content" message. Owners only. */
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
  const { data: cfg } = await admin
    .from("telegram_config")
    .select("chat_id, shoot_notice_message_id")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!cfg?.chat_id || cfg.shoot_notice_message_id == null) return NextResponse.json({ error: "no message" });
  const res = await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(cfg.shoot_notice_message_id) });
  if (res.ok) {
    await admin.from("telegram_config").update({ shoot_notice_message_id: null }).eq("persona_id", personaId);
  }
  return NextResponse.json({ deleted: cfg.shoot_notice_message_id, ...res });
}
