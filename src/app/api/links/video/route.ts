import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { fetchInspoVideo, pendingVideoLinks } from "@/lib/inspo-video";
import { instagramKey } from "@/lib/telegram";

/**
 * Fetch the reel behind an inspo link and post it into the topic.
 *
 *   ?link=<id>              one link — what the webhook fires after a post
 *   ?url=<instagram url>    the same, found by the post
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

  // ?report=failed — the open links whose reel could not be fetched, with
  // the reason. Not deleted by anything: "not readable" is gone, private
  // or age-gated, and only a person can tell which.
  if (url.searchParams.get("report") === "failed") {
    let q = supabase
      .from("content_links")
      .select("url, video_error, posted_at, message_id")
      .eq("status", "open")
      .not("video_error", "is", null)
      .order("posted_at", { ascending: true });
    if (personaId) q = q.eq("persona_id", personaId);
    const { data } = await q;
    return NextResponse.json({ ok: true, failed: data ?? [] });
  }
  if (url.searchParams.get("report") === "pending") {
    const ids = await pendingVideoLinks(supabase, { personaId, limit: 1000, openOnly: true });
    return NextResponse.json({ ok: true, pending: ids.length });
  }
  const one = url.searchParams.get("link");
  const byUrl = url.searchParams.get("url");
  const key = byUrl ? instagramKey(byUrl) : null;
  const ids = one
    ? [one]
    : key
      ? ((
          await supabase
            .from("content_links")
            .select("id")
            .eq("url_key", key)
            .order("posted_at", { ascending: false })
            .limit(1)
        ).data ?? []).map((r) => r.id)
      : await pendingVideoLinks(supabase, {
        personaId,
        limit: Math.min(200, Number(url.searchParams.get("limit") ?? 20)),
        openOnly: url.searchParams.get("only") === "open",
        oldestFirst: url.searchParams.get("order") === "oldest",
      });

  // Notes travel with a single link only — they are what the sender wrote
  // beside it, and a backlog run has no such thing.
  const note = one ? url.searchParams.get("note") : null;
  const deadline = Date.now() + 270_000;
  const results = [];
  for (const id of ids) {
    if (Date.now() > deadline) break;
    results.push(await fetchInspoVideo(supabase, id, note));
  }
  return NextResponse.json({ ok: true, done: results.length, of: ids.length, results });
}
