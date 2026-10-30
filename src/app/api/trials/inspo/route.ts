import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTrialInspo } from "@/lib/inspo-video";

/**
 * Set the original inspo of a trial and keep its video.
 *
 *   POST /api/trials/inspo?id=<trial id>   body: { link }
 */
export const maxDuration = 120;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const { link } = (await req.json().catch(() => ({}))) as { link?: string };
  if (!id || !link?.trim().startsWith("http")) return NextResponse.json({ ok: false, note: "id or link missing" }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, note: "not signed in" }, { status: 401 });
  const { data: visible } = await supabase.from("trials").select("id").eq("id", id).maybeSingle();
  if (!visible) return NextResponse.json({ ok: false, note: "no such trial" }, { status: 404 });
  return NextResponse.json(await fetchTrialInspo(createAdminClient(), id, link.trim()));
}
