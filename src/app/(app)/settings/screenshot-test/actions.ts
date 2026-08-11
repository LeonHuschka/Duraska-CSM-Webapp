"use server";

import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { extractMetricsFromImage } from "@/lib/vision";
import { matchTiles } from "@/lib/match-tile";

import { cropTile, refineGrid } from "@/lib/fingerprint";

export type TileResult = {
  position: number;
  views: number | null;
  caption: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  crop: string | null;
  match: {
    title: string;
    method: "landmarks" | "image" | "text" | "looked";
    /**
     * A proposal nobody has confirmed. It is written like any other match
     * so no reading is lost, but it is marked, and it does not spend the
     * cut — otherwise a guess would take the reel the next tile needed.
     */
    needsCheck?: boolean;
    /** Written here, not in the browser: a stale bundle mislabelled a
     *  match once, and the reader had no way to tell. */
    explain: string;
    thumb: string | null;
    /** For a text match, both sides of the comparison, so a wrong one is
     *  obvious instead of arguable. */
    tileText?: string | null;
    cutText?: string | null;
  } | null;
  /** Why it refused, when it did — the number that made the decision. */
  nearest: { title: string; distance: number; ratio: number } | null;
  /** The three closest cuts by name, so "it isn't in the vault" can be told
   *  apart from "it is there but the picture drifted". */
  closest: { title: string; distance: number }[];
};

/**
 * Step one: read the screenshot and cut the tiles out.
 *
 * Split from the identifying because the two together do not fit in the
 * minute a function gets — the extraction call alone spends twenty seconds,
 * and comparing landmarks costs about half a second per candidate. The same
 * split is what the Telegram handler will need.
 *
 * The point is that the layout is not ours to control: each VA screenshots
 * a different surface, and hiring the next one changes it again. Nothing
 * here assumes a grid shape — the tiles are located by the model and
 * identified by their picture — so the only way to know a new format works
 * is to run one through and look. This is that.
 */
export async function readScreenshot(form: FormData) {
  await requireActivePersonaId();

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No image" };
  }
  if (file.size > 12 * 1024 * 1024) {
    return { error: "That image is larger than 12 MB" };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");
  const mime = file.type || "image/jpeg";

  const { data: metrics, error } = await extractMetricsFromImage(base64, mime);
  if (error || !metrics) return { error: error ?? "extraction failed" };

  const raw = metrics.reels.map((r) => r.box);
  const boxes = await refineGrid(buf, raw);

  // Both sets drawn onto the screenshot, because four attempts at correcting
  // these were made without anyone ever looking at what was being corrected.
  const overlay = await drawBoxes(buf, raw, boxes);
  const cut: { position: number; views: number | null; caption: string | null; crop: string | null }[] = [];

  for (let i = 0; i < metrics.reels.length; i++) {
    const r = metrics.reels[i];
    const box = boxes[i];
    let crop: string | null = null;
    if (box) {
      try {
        crop = (await cropTile(buf, box)).toString("base64");
      } catch {
        // A box the picture cannot support yields no tile, and the caller
        // sees that as plainly as it sees a good one.
      }
    }
    cut.push({ position: r.position, views: r.views, caption: r.caption, crop });
  }

  return {
    error: null,
    overlay,
    kind: metrics.metric_kind,
    handle: metrics.handle,
    followers: metrics.followers,
    confidence: metrics.confidence,
    tiles: cut,
  };
}

/**
 * The model's rectangles in red, what they were turned into in green.
 * One look answers what a page of numbers cannot.
 */
async function drawBoxes(
  image: Buffer,
  raw: ({ x: number; y: number; w: number; h: number } | null)[],
  fixed: ({ x: number; y: number; w: number; h: number } | null)[]
): Promise<string | null> {
  try {
    const meta = await sharp(image).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return null;
    const rect = (
      b: { x: number; y: number; w: number; h: number },
      colour: string,
      dash: string
    ) =>
      `<rect x="${(b.x * w).toFixed(0)}" y="${(b.y * h).toFixed(0)}" width="${(b.w * w).toFixed(0)}" height="${(b.h * h).toFixed(0)}" fill="none" stroke="${colour}" stroke-width="4" stroke-dasharray="${dash}"/>`;
    const svg =
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      raw.map((b) => (b ? rect(b, "#ff3b30", "10 6") : "")).join("") +
      fixed.map((b) => (b ? rect(b, "#34c759", "0") : "")).join("") +
      `</svg>`;
    const out = await sharp(image)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .resize(520, null)
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Step two: say which cut each tile shows.
 *
 * A thin wrapper on the matcher the Telegram handler uses, so the page can
 * never drift from what the bot actually does — it did, for hours, and the
 * page looked healthy while the bot was still deciding with a hash.
 */
export async function identifyTiles(input: {
  tiles: { position: number; caption: string | null; crop: string | null }[];
  taken: string[];
}) {
  const personaId = await requireActivePersonaId();
  const supabase = await createClient();

  const res = await matchTiles(supabase, {
    personaId,
    tiles: input.tiles.map((t) => ({
      position: t.position,
      caption: t.caption,
      crop: t.crop ? Buffer.from(t.crop, "base64") : null,
    })),
    taken: input.taken,
  });

  // One signing call for every thumbnail about to be shown.
  const paths = res.tiles
    .map((t) => t.thumbPath)
    .filter((p): p is string => !!p);
  const url = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(Array.from(new Set(paths)), 900);
    for (const s of signed ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
  }

  const cropOf = new Map(input.tiles.map((t) => [t.position, t.crop]));
  const captionOf = new Map(input.tiles.map((t) => [t.position, t.caption]));
  const tiles: TileResult[] = res.tiles.map((t) => ({
    position: t.position,
    views: null,
    caption: captionOf.get(t.position) ?? null,
    box: null,
    crop: cropOf.get(t.position) ? `data:image/jpeg;base64,${cropOf.get(t.position)}` : null,
    match: t.assetId
      ? {
          title: t.title ?? "—",
          method: t.method === "text" ? "text" : "landmarks",
          needsCheck: t.needsCheck,
          explain:
            t.method === "text"
              ? `by text — ${Math.round(t.score * 100)}% alike`
              : `${t.needsCheck ? "probably" : "by landmarks"} — ${t.score} shared, ${t.lead.toFixed(1)}× the runner-up`,
          thumb: t.thumbPath ? (url.get(t.thumbPath) ?? null) : null,
        }
      : null,
    nearest: t.assetId
      ? null
      : { title: "nothing plausible", distance: t.score, ratio: t.lead },
    closest: t.closest.map((c) => ({ title: c.title, distance: c.score })),
  }));

  return {
    error: null,
    tiles,
    taken: res.taken,
    poolSize: res.poolSize,
    landmarkPool: res.landmarkPool,
    textPoolSize: res.poolSize,
    byMethod: {
      landmarks: tiles.filter((t) => t.match?.method === "landmarks" && !t.match.needsCheck).length,
      image: 0,
      text: tiles.filter((t) => t.match?.method === "text").length,
      toCheck: tiles.filter((t) => t.match?.needsCheck).length,
    },
  };
}
