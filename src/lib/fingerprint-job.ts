import { createAdminClient } from "@/lib/supabase/admin";
import { fingerprint, fingerprintSet } from "@/lib/fingerprint";
import { readOverlayTexts } from "@/lib/vision";

/**
 * Give finished cuts the two handles a screenshot is matched against: a
 * perceptual hash of the thumbnail, and the hook text burnt into the clip.
 *
 * Works on whatever is still missing them and stops before the caller's
 * deadline, so it is safe to run again and again until nothing is left.
 */

const HASH_BATCH = 60;
const TEXT_BATCH = 12;

export async function fingerprintPending(deadline: number) {
  const supabase = createAdminClient();

  const { data: pending, error } = await supabase
    .from("content_assets")
    .select("id, thumbnail_path, overlay_text, fingerprinted_at")
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .or("fingerprinted_at.is.null,phashes.is.null")
    .limit(HASH_BATCH);

  if (error) return { ok: false, error: error.message };
  if (!pending?.length) return { ok: true, done: true, hashed: 0, written: 0, remaining: 0 };

  // Signing is metadata only; the bytes below are a few tens of kilobytes
  // per thumbnail, which is why this never touches the videos themselves.
  const paths = pending.map((a) => a.thumbnail_path!).filter(Boolean);
  const { data: signed } = await supabase.storage
    .from("content-assets")
    .createSignedUrls(paths, 900);
  const urlFor = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlFor.set(s.path, s.signedUrl);
  }

  const loaded: {
    id: string;
    buf: Buffer;
    hash: string;
    hashes: string[];
    textDone: boolean;
  }[] = [];
  for (const a of pending) {
    if (Date.now() > deadline) break;
    const url = a.thumbnail_path ? urlFor.get(a.thumbnail_path) : undefined;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      loaded.push({
        id: a.id,
        buf,
        hash: await fingerprint(buf),
        // One per window a platform might crop the frame to — a 3:4 tile
        // cannot be recognised by a fingerprint of the whole 9:16 frame.
        hashes: await fingerprintSet(buf),
        // Its hook was read on an earlier run. Reading it again would cost
        // the same as the first time and produce the same answer.
        textDone: a.fingerprinted_at !== null,
      });
    } catch {
      // A thumbnail that won't load stays unfingerprinted and is retried,
      // rather than being marked done with nothing to show for it.
    }
  }

  const texts = new Map<string, string | null>();
  const needText = loaded.filter((l) => !l.textDone);
  for (let i = 0; i < needText.length; i += TEXT_BATCH) {
    if (Date.now() > deadline) break;
    const slice = needText.slice(i, i + TEXT_BATCH);
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
    // Only rows whose text was actually read are closed out — otherwise a
    // cut would be left permanently unmatchable by its text.
    // A cut whose hook has not been read yet stays open, so a later run
    // finishes it rather than leaving it unmatchable by text forever.
    if (!l.textDone && !texts.has(l.id)) continue;
    // Leave a text that was already read alone; only fill one we just read.
    const base = {
      phash: l.hash,
      phashes: l.hashes,
      fingerprinted_at: new Date().toISOString(),
    };
    const { error: uerr } = await supabase
      .from("content_assets")
      .update(
        l.textDone ? base : { ...base, overlay_text: texts.get(l.id) ?? null }
      )
      .eq("id", l.id);
    if (!uerr) written++;
  }

  const { count: left } = await supabase
    .from("content_assets")
    .select("id", { count: "exact", head: true })
    .eq("stage", "edited")
    .not("thumbnail_path", "is", null)
    .or("fingerprinted_at.is.null,phashes.is.null");

  return { ok: true, done: (left ?? 0) === 0, hashed: loaded.length, written, remaining: left ?? 0 };
}
