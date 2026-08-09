"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";

/**
 * The cuts that still need a strip of stills, with a link to their video.
 *
 * The strip is made in the browser because that is where the video is
 * already decoded — a server would have to fetch every file to do the same
 * work, and the files are the one thing in this system that costs real
 * money to move.
 */
export async function cutsNeedingFrames(limit = 200) {
  const personaId = await requireActivePersonaId();
  const supabase = await createClient();

  const { data: reqs } = await supabase
    .from("content_requests")
    .select("id")
    .eq("persona_id", personaId);
  const ids = (reqs ?? []).map((r) => r.id);
  if (!ids.length) return { error: null, cuts: [] };

  const { data: cuts, error } = await supabase
    .from("content_assets")
    .select("id, file_path, file_name, mime_type")
    .in("request_id", ids)
    .eq("stage", "edited")
    .is("frames_path", null)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message, cuts: [] };

  const paths = (cuts ?? []).map((c) => c.file_path).filter(Boolean);
  const { data: signed } = await supabase.storage
    .from("content-assets")
    .createSignedUrls(paths, 3600);
  const urlFor = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlFor.set(s.path, s.signedUrl);
  }

  return {
    error: null,
    cuts: (cuts ?? [])
      .filter((c) => urlFor.has(c.file_path))
      .map((c) => ({
        id: c.id,
        name: c.file_name,
        mime: c.mime_type ?? "video/mp4",
        path: c.file_path,
        url: urlFor.get(c.file_path)!,
      })),
  };
}

/** Record the strip. The hashes themselves are computed server-side later. */
export async function saveFrames(assetId: string, framesPath: string, count: number) {
  await requireActivePersonaId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_assets")
    .update({ frames_path: framesPath, frame_count: count, phashes: null })
    .eq("id", assetId);
  return { error: error?.message ?? null };
}

/** Cuts that carry a strip but no fingerprints from it yet. */
export async function framesProgress() {
  const personaId = await requireActivePersonaId();
  const supabase = await createClient();
  const { data: reqs } = await supabase
    .from("content_requests")
    .select("id")
    .eq("persona_id", personaId);
  const ids = (reqs ?? []).map((r) => r.id);
  if (!ids.length) return { total: 0, withFrames: 0, hashed: 0 };

  const count = async (q: (b: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n } = await q(base());
    return n ?? 0;
  };
  const base = () =>
    supabase
      .from("content_assets")
      .select("id", { count: "exact", head: true })
      .in("request_id", ids)
      .eq("stage", "edited")
      .is("deleted_at", null);

  return {
    total: await count((b) => b),
    withFrames: await count((b) => b.not("frames_path", "is", null)),
    hashed: await count((b) => b.not("phashes", "is", null)),
  };
}
