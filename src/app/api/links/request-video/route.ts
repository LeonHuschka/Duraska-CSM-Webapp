import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRequestInspo } from "@/lib/inspo-video";

/**
 * Keep the inspo reel of a job the model started on the upload page.
 * The upload page fires this once the job exists; anyone who can see the
 * job may ask, the fetch itself runs with the service key. The job page
 * sends a new link along when the old one gave no video.
 *
 *   POST /api/links/request-video?id=<request id>   body (optional): { link }
 */
export const maxDuration = 120;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id missing" }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: visible } = await supabase.from("content_requests").select("id").eq("id", id).maybeSingle();
  if (!visible) return NextResponse.json({ error: "no such job" }, { status: 404 });
  const { link } = (await req.json().catch(() => ({}))) as { link?: string };
  if (link?.trim().startsWith("http")) {
    await supabase
      .from("content_requests")
      .update({ inspo_link: link.trim(), inspo_video_path: null, inspo_video_error: null })
      .eq("id", id);
  }
  return NextResponse.json(await fetchRequestInspo(createAdminClient(), id));
}
