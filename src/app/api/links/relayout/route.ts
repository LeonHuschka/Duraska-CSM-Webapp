import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { editMessageCaption } from "@/lib/telegram";
import { caption } from "@/lib/inspo-video";
import { layoutNote } from "@/lib/note-layout";

/**
 * The videos still to be shot, captioned again so their notes show in the
 * new layout. Opened in a browser signed in as an owner.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle();
  if (profile?.global_role !== "owner") return NextResponse.json({ error: "owners only" }, { status: 403 });

  const admin = createAdminClient();
  const { data: links } = await admin
    .from("content_links")
    .select("id, chat_id, url, note, video_message_id")
    .eq("status", "open")
    .not("note", "is", null)
    .not("video_message_id", "is", null)
    .limit(300);
  let edited = 0;
  const failed: string[] = [];
  for (const l of links ?? []) {
    if (!l.note || layoutNote(l.note) === l.note) continue;
    const res = await editMessageCaption({
      chat_id: l.chat_id,
      message_id: Number(l.video_message_id),
      caption: caption(l.url, l.note),
    });
    if (res.ok) edited++;
    else failed.push(`${l.id}: ${res.error}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  return NextResponse.json({ open: links?.length ?? 0, edited, failed });
}
