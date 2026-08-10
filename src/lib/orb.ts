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
 * How many landmarks to keep on each side.
 *
 * More is not better on the tile: at 1500 the correct answer beats the best
 * wrong one by 2.8 to 1, at 5000 only by 2.3, because every extra landmark
 * is another chance to resemble something it should not. It is also three
 * times cheaper — a comparison costs 264ms here against 879ms — and the
 * comparison is what a screenshot spends its time on.
 */
export const TILE_FEATURES = 1500;
export const INDEX_FEATURES = 3000;

/**
 * How deep the hash's shortlist goes.
 *
 * The hash cannot judge a match across crops, but for a tile in the same
 * shape as our thumbnails it sorts one to the front reliably: measured over
 * all 122 cuts, the correct answer was never worse than sixth. Twenty
 * leaves three times that much room, and keeps a screenshot inside its
 * minute — comparing all 122 would take a quarter of an hour.
 */
export const SHORTLIST = 20;

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

// Measured across all 122 cuts on tiles in our own 9:16 shape: correct
// answers shared far more than this and led by at least 2.8 to 1. Below
// either bar nothing is claimed — a tile we cannot place is worth more as a
// gap than as a plausible wrong answer.
const MIN_SHARED = 50;
const MIN_LEAD = 1.6;

export type LandmarkCandidate = {
  id: string;
  requestId: string;
  index: { count: number; data: Buffer };
};

export type LandmarkVerdict =
  | { kind: "match"; candidate: LandmarkCandidate; shared: number; lead: number }
  | { kind: "unsure"; shared: number; lead: number; best: LandmarkCandidate | null };

/** Which cut this tile shows, or a refusal. */
export async function identifyByLandmarks(
  tile: { count: number; data: Buffer },
  pool: LandmarkCandidate[]
): Promise<LandmarkVerdict> {
  if (pool.length === 0) return { kind: "unsure", shared: 0, lead: 0, best: null };

  let best: LandmarkCandidate | null = null;
  let bestN = 0;
  let secondN = 0;
  for (const c of pool) {
    const n = await sharedLandmarks(tile, c.index);
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
