import sharp from "sharp";

/**
 * Recognising a reel by its local features rather than by its overall shape.
 *
 * A perceptual hash squeezes a whole picture into 256 bits, so it cannot
 * survive being cropped — every bit moves. That is fatal here, because
 * Instagram's grid shows our 9:16 frame whole while Meta's library shows a
 * 3:4 band of it, and the cover frame is rarely the moment our thumbnail was
 * cut from.
 *
 * Local features do survive both. Hundreds of small landmarks are described
 * individually: a crop simply contains fewer of them, and a subject who has
 * moved leaves the room, the wall and the bed exactly where they were.
 *
 * Measured against all 122 cuts in the vault, on tiles cut from handheld
 * photos of a phone screen: six of six identified across both formats,
 * including the two the hash refused. Correct answers scored 178 to 770
 * matching landmarks against 82 to 120 for the best wrong candidate.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
let cvPromise: Promise<CV> | null = null;

async function getCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise = import("@techstark/opencv-js").then(
      async (mod) => await ((mod as unknown as { default?: unknown }).default ?? mod)
    ) as Promise<CV>;
  }
  return cvPromise;
}

// Everything is measured at this width. Landmarks are found per scale, so
// two pictures only describe the same thing if they were read at the same
// size.
const WIDTH = 520;

/**
 * How many landmarks to keep. The tile side is generous because it is read
 * once; the stored side is the one that costs time on every comparison, and
 * cutting it is what makes a screenshot fit in a function: 3000 landmarks
 * cost 527ms per comparison against 879ms at 5000, and still separate the
 * hardest measured case by two to one.
 */
export const TILE_FEATURES = 5000;
export const INDEX_FEATURES = 3000;

/**
 * A first pass over every candidate, with few enough landmarks on the tile
 * to be affordable.
 *
 * This replaces the perceptual hash as the shortlist. The hash was ranking
 * the right answer outside the top twelve on the very tiles this was built
 * for — it cannot survive a crop, which is the whole reason the landmarks
 * exist — so it was quietly hiding the correct cut from the stage that
 * could have recognised it. Measured over all 122 cuts, 600 landmarks on
 * the tile put the right answer first for every tile tried.
 */
export const SCAN_FEATURES = 600;
const SHORTLIST = 5;

/** The landmarks of one picture, as bytes that can be stored and reloaded. */
export async function describe(
  image: Buffer,
  features: number
): Promise<{ count: number; data: Buffer } | null> {
  const cv = await getCv();
  const { data, info } = await sharp(image)
    .greyscale()
    .resize(WIDTH, null)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1);
  mat.data.set(data);
  const eq = new cv.Mat();
  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  clahe.apply(mat, eq);

  const orb = new cv.ORB(features, 1.12, 14, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 6);
  const kp = new cv.KeyPointVector();
  const des = new cv.Mat();
  const empty = new cv.Mat();
  orb.detectAndCompute(eq, empty, kp, des);

  const rows = des.rows;
  const out =
    rows > 0 ? Buffer.from(des.data.slice(0, rows * 32)) : null;

  mat.delete();
  eq.delete();
  kp.delete();
  des.delete();
  empty.delete();

  return out ? { count: rows, data: out } : null;
}

/**
 * How many landmarks the two pictures share.
 *
 * A landmark counts only when its best partner is clearly better than its
 * second best — the standard guard against the many near-identical patterns
 * any photograph contains. No geometric check follows: OpenCV's is missing
 * from this build, and measurement says it is not needed, since the raw
 * count already separates a correct answer from the best wrong one by at
 * least two to one.
 */
export async function sharedLandmarks(
  a: { count: number; data: Buffer },
  b: { count: number; data: Buffer }
): Promise<number> {
  const cv = await getCv();
  if (a.count < 8 || b.count < 8) return 0;

  const ma = new cv.Mat(a.count, 32, cv.CV_8UC1);
  ma.data.set(new Uint8Array(a.data));
  const mb = new cv.Mat(b.count, 32, cv.CV_8UC1);
  mb.data.set(new Uint8Array(b.data));

  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  bf.knnMatch(ma, mb, matches, 2);

  let good = 0;
  for (let i = 0; i < matches.size(); i++) {
    const m = matches.get(i);
    if (m.size() === 2 && m.get(0).distance < 0.8 * m.get(1).distance) good++;
    m.delete();
  }

  ma.delete();
  mb.delete();
  matches.delete();
  return good;
}

// Measured worst case: the correct answer scored 178 with the best wrong one
// at 82. Below either bar nothing is claimed — a tile we cannot place is
// worth far more as a gap than as a plausible wrong answer.
const MIN_SHARED = 60;
const MIN_LEAD = 1.6;

export type LandmarkCandidate = {
  id: string;
  requestId: string;
  index: { count: number; data: Buffer };
};

export type LandmarkVerdict =
  | { kind: "match"; candidate: LandmarkCandidate; shared: number; lead: number }
  | { kind: "unsure"; shared: number; lead: number; best: LandmarkCandidate | null };

/**
 * Which cut this tile shows, or a refusal.
 *
 * Two passes: a cheap one over everything to find the few worth looking at,
 * then the full comparison on those. Scanning everything at full detail
 * would cost a minute per tile; letting a hash pick the shortlist is what
 * hid the right answer.
 */
export async function identifyByLandmarks(
  scan: { count: number; data: Buffer },
  full: { count: number; data: Buffer },
  pool: LandmarkCandidate[]
): Promise<LandmarkVerdict> {
  if (pool.length === 0) return { kind: "unsure", shared: 0, lead: 0, best: null };

  const rough: { c: LandmarkCandidate; n: number }[] = [];
  for (const c of pool) rough.push({ c, n: await sharedLandmarks(scan, c.index) });
  rough.sort((a, b) => b.n - a.n);

  let best: LandmarkCandidate | null = null;
  let bestN = 0;
  let secondN = 0;
  for (const { c } of rough.slice(0, SHORTLIST)) {
    const n = await sharedLandmarks(full, c.index);
    if (n > bestN) {
      secondN = bestN;
      bestN = n;
      best = c;
    } else if (n > secondN) {
      secondN = n;
    }
  }

  const lead = bestN / Math.max(secondN, 1);
  if (!best || bestN < MIN_SHARED || lead < MIN_LEAD) {
    return { kind: "unsure", shared: bestN, lead, best };
  }
  return { kind: "match", candidate: best, shared: bestN, lead };
}
