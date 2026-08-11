import "server-only";

/**
 * A short vector describing what a picture shows.
 *
 * This is the shortlist stage, and it is the one that decides how fast a
 * screenshot can be read. Measured against all 122 cuts in the vault, on
 * tiles taken from photos of a phone screen:
 *
 *   perceptual hash    right answer never better than rank 6
 *   visual vocabulary  rank 5
 *   embeddings         rank 2
 *
 * Rank two means five candidates are enough where the hash needed twenty,
 * and since a landmark comparison costs a quarter of a second, that is the
 * difference between six seconds a tile and one and a half.
 *
 * It also found a cut the landmarks could not: a reel filmed from another
 * angle in different light, which shares too few pixels to match but is
 * plainly the same scene to something that understands scenes.
 *
 * Not a judge, though — its own margins run 1.1 to 1.6, far too close to
 * decide on. It proposes; the landmarks decide.
 */

const MODEL = "voyage-multimodal-3";
export const EMBEDDING_DIMS = 1024;

/**
 * Embed a batch of images. Returns null when no key is configured, which
 * the callers treat as "fall back to the perceptual hash" rather than as a
 * failure — the system stays usable, just slower.
 */
export async function embedImages(
  images: { base64: string; mime: string }[]
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  if (images.length === 0) return [];

  try {
    const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // One "document" per image, each a single image content part.
        inputs: images.map((img) => ({
          content: [
            {
              type: "image_base64",
              image_base64: `data:${img.mime};base64,${img.base64}`,
            },
          ],
        })),
        input_type: "document",
      }),
    });

    if (!res.ok) {
      console.warn(`[embedding] Voyage answered ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      data?: { embedding?: number[]; index?: number }[];
    };
    const rows = body.data ?? [];
    if (rows.length !== images.length) {
      console.warn("[embedding] answer did not cover every image");
      return null;
    }
    // The API may reorder; put them back the way they went in.
    const out: number[][] = new Array(images.length);
    rows.forEach((r, i) => {
      const at = typeof r.index === "number" ? r.index : i;
      if (r.embedding) out[at] = r.embedding;
    });
    return out.every(Boolean) ? out : null;
  } catch (err) {
    console.warn("[embedding] call failed", err);
    return null;
  }
}

/** Postgres vector literal, the form pgvector accepts on the wire. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}
