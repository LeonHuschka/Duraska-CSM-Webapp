import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { fetchInspoVideo, pendingVideoLinks } from "@/lib/inspo-video";

/**
 * Fetch the reel behind an inspo link and post it into the topic.
 *
 *   ?link=<id>              one link — what the webhook fires after a post
 *   ?persona=<id>&limit=N   the backlog, newest first, until time runs out
 *
 * Own invocation on purpose: the webhook has to answer Telegram within
 * seconds, and a download plus an upload is not seconds.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") ?? req.headers.get("x-link-check-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return run(url, url.searchParams.get("persona") ?? undefined);
}

/**
 * The same, as the person who is logged in — an owner or manager opening
 * the URL in a browser. For the backlog, and for trying it by hand.
 */
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
  return run(new URL(req.url), personaId);
}

async function run(url: URL, personaId: string | undefined) {
  const supabase = createAdminClient();
  const one = url.searchParams.get("link");
  const ids = one
    ? [one]
    : await pendingVideoLinks(supabase, {
        personaId,
        limit: Math.min(200, Number(url.searchParams.get("limit") ?? 20)),
      });

  const deadline = Date.now() + 270_000;
  const results = [];
  for (const id of ids) {
    if (Date.now() > deadline) break;
    results.push(await fetchInspoVideo(supabase, id));
  }
  return NextResponse.json({ ok: true, done: results.length, of: ids.length, results });
}
