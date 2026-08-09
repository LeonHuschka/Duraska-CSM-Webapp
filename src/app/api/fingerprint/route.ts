import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fingerprint } from "@/lib/fingerprint";
import { readOverlayTexts } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Give every finished cut the two handles a screenshot can be matched
 * against: a perceptual hash of its thumbnail, and the hook text burnt into
 * it.
 *
 * Runs on the cuts that don't have them yet and stops well before the
 * function's limit, so it is safe to call repeatedly until it reports
 * nothing left. New cuts are picked up by the same job rather than by a
 * separate path at upload — one code path means one behaviour.
 */

const HASH_BATCH = 60;
const TEXT_BATCH = 12;
const BUDGET_MS = 45_000;

export async function GET(req: Request) {
  // Either the scheduler, or a signed-in owner opening the URL. The second
  // exists so the backfill can be started without anyone handling a secret.
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
    .select("id, thumbnail_path, phash, overlay_text")
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .is("fingerprinted_at", null)
    .limit(HASH_BATCH);

  if (error) return NextResponse.json({ ok: false, error: error.message });
  if (!pending?.length) {
    return NextResponse.json({ ok: true, done: true, hashed: 0, texts: 0 });
  }

  // Sign in one call — signing is metadata only, the bytes come from the
  // fetches below and a thumbnail is a few tens of kilobytes.
  const paths = pending.map((a) => a.thumbnail_path!).filter(Boolean);
  const { data: signed } = await supabase.storage
    .from("content-assets")
    .createSignedUrls(paths, 900);
  const urlFor = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlFor.set(s.path, s.signedUrl);
  }

  const loaded: { id: string; buf: Buffer; hash: string }[] = [];
  for (const a of pending) {
    if (Date.now() > deadline) break;
    const url = a.thumbnail_path ? urlFor.get(a.thumbnail_path) : undefined;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      loaded.push({ id: a.id, buf, hash: await fingerprint(buf) });
    } catch {
      // A thumbnail that won't load stays unfingerprinted and is retried on
      // the next run rather than being marked done.
    }
  }

  // Read the hook text in small batches. This is the only part that costs
  // anything, and it is spent once per cut for the life of the cut.
  const texts = new Map<string, string | null>();
  for (let i = 0; i < loaded.length; i += TEXT_BATCH) {
    if (Date.now() > deadline) break;
    const slice = loaded.slice(i, i + TEXT_BATCH);
    const { data, error: terr } = await readOverlayTexts(
      slice.map((l) => ({ base64: l.buf.toString("base64"), mime: "image/jpeg" }))
    );
    if (terr || !data) {
      console.warn("[fingerprint] text read failed", terr);
      break;
    }
    slice.forEach((l, j) => texts.set(l.id, data[j] ?? null));
  }

  let written = 0;
  for (const l of loaded) {
    // Only the rows whose text was actually read are closed out. The rest
    // keep fingerprinted_at null so a later run finishes the job instead of
    // leaving a cut that can never be matched by text.
    if (!texts.has(l.id)) continue;
    const { error: uerr } = await supabase
      .from("content_assets")
      .update({
        phash: l.hash,
        overlay_text: texts.get(l.id),
        fingerprinted_at: new Date().toISOString(),
      })
      .eq("id", l.id);
    if (!uerr) written++;
  }

  const { count: left } = await supabase
    .from("content_assets")
    .select("id", { count: "exact", head: true })
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .is("fingerprinted_at", null);

  return NextResponse.json({
    ok: true,
    done: (left ?? 0) === 0,
    hashed: loaded.length,
    written,
    remaining: left ?? 0,
  });
}
