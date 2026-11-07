import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteMessage } from "@/lib/telegram";
import { refreshShootList } from "@/lib/shoot-list";

/**
 * Take back a winner that should not have been one: its post in the
 * winners topic, its record, and the Trial-Maxxing it opened (dismissed,
 * so it leaves SHOOTING). Opened in a browser signed in as an owner,
 * `?id=<winner id>`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle();
  if (profile?.global_role !== "owner") return NextResponse.json({ error: "owners only" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  const admin = createAdminClient();
  const { data: w } = await admin
    .from("winners")
    .select("id, persona_id, account_id, shortcode, message_id")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "no such winner" }, { status: 404 });

  const { data: cfg } = await admin.from("telegram_config").select("chat_id").eq("persona_id", w.persona_id).maybeSingle();
  const message =
    cfg?.chat_id && w.message_id != null
      ? await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(w.message_id) })
      : null;
  const { data: trials } = await admin
    .from("trials")
    .update({ status: "dismissed", status_note: "Winner taken back", updated_at: new Date().toISOString() })
    .eq("persona_id", w.persona_id)
    .eq("shortcode", w.shortcode)
    .in("status", ["active", "proposed"])
    .select("id");
  await admin.from("winners").delete().eq("id", w.id);
  await refreshShootList(admin, w.persona_id);
  return NextResponse.json({
    ok: true,
    message: message ? (message.ok ? "deleted" : message.error) : "none",
    trialsDismissed: trials?.length ?? 0,
  });
}
