import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { describe, INDEX_FEATURES } from "@/lib/orb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Describe the landmarks of every finished cut, once.
 *
 * Kept apart from the fingerprint job because it costs about a quarter of a
 * second per cut and would otherwise crowd out the hook-text reading that
 * job also does. Safe to call repeatedly until it reports nothing left.
 */
const BATCH = 40;
const BUDGET_MS = 45_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  let authed =
    req.headers.get("x-vercel-cron") !== null ||
    (!!secret && new URL(req.url).searchParams.get("secret") === secret);
  if (!authed) {
    const session = await createClient();
    const { data: user } = await session.auth.getUser();
    if (user.user) {
      const { data: role } = await session
        .from("persona_members")
        .select("role")
        .eq("user_id", user.user.id)
        .in("role", ["owner", "manager"])
        .limit(1)
        .maybeSingle();
      authed = !!role;
    }
  }
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  const deadline = Date.now() + BUDGET_MS;
  const supabase = createAdminClient();

  const { data: pending, error } = await supabase
    .from("content_assets")
    .select("id, thumbnail_path")
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .is("orb_index", null)
    .limit(BATCH);
  if (error) return NextResponse.json({ ok: false, error: error.message });
  if (!pending?.length) return NextResponse.json({ ok: true, done: true, written: 0 });

  const { data: signed } = await supabase.storage
    .from("content-assets")
    .createSignedUrls(pending.map((a) => a.thumbnail_path!), 900);
  const urlFor = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) urlFor.set(s.path, s.signedUrl);

  let written = 0;
  let failed = 0;
  for (const a of pending) {
    if (Date.now() > deadline) break;
    const url = a.thumbnail_path ? urlFor.get(a.thumbnail_path) : undefined;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const described = await describe(Buffer.from(await res.arrayBuffer()), INDEX_FEATURES);
      if (!described) {
        failed++;
        continue;
      }
      const { error: uerr } = await supabase
        .from("content_assets")
        .update({
          orb_index: described.data.toString("base64"),
          orb_count: described.count,
        })
        .eq("id", a.id);
      if (uerr) failed++;
      else written++;
    } catch {
      failed++;
    }
  }

  const { count: left } = await supabase
    .from("content_assets")
    .select("id", { count: "exact", head: true })
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .is("orb_index", null);

  return NextResponse.json({
    ok: true,
    done: (left ?? 0) === 0,
    written,
    failed,
    remaining: left ?? 0,
  });
}
