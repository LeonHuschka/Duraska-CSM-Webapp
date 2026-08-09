import sharp from "sharp";

/**
 * Recognising one of our own reels in a screenshot of an account.
 *
 * The tile in a profile grid is a frame of a video we hold, so identity is
 * decidable from the picture — but only decidable, never obvious: the cover
 * frame is rarely the frame our thumbnail was cut from, and Instagram
 * sometimes shows a tighter crop than we stored.
 *
 * Measured against a handheld photo of a phone screen and all 122 cuts in
 * the vault: four of five tiles identified correctly, none identified
 * wrongly, one missed. The one it missed was zoomed in — see MAX_RATIO for
 * why that ends in a refusal rather than a guess.
 */

// A 17×16 grey image compared left-to-right gives 256 bits. Larger grids
// discriminate better but start tracking noise; smaller ones stop telling
// two takes from the same session apart.
const W = 17;
const H = 16;
export const HASH_BITS = (W - 1) * H;

/**
 * The bottom fifth is dropped before hashing. Instagram prints the view
 * count there, and a five-digit number where we stored an ankle is a
 * difference the hash would otherwise have to explain away.
 */
const CROP_BOTTOM = 0.2;

export async function fingerprint(image: Buffer): Promise<string> {
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("unreadable image");

  const keep = Math.max(1, Math.round(h * (1 - CROP_BOTTOM)));
  const raw = await sharp(image)
    .extract({ left: 0, top: 0, width: w, height: keep })
    .greyscale()
    .resize(W, H, { fit: "fill" })
    .raw()
    .toBuffer();

  let bits = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits += raw[y * W + x] < raw[y * W + x + 1] ? "1" : "0";
    }
  }
  // Hex, so it is a short column and comparable without decoding.
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Cut one tile out of a screenshot, given a box in fractions of the image. */
export async function cropTile(
  image: Buffer,
  box: { x: number; y: number; w: number; h: number }
): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  const left = Math.max(0, Math.min(iw - 1, Math.round(box.x * iw)));
  const top = Math.max(0, Math.min(ih - 1, Math.round(box.y * ih)));
  const width = Math.max(8, Math.min(iw - left, Math.round(box.w * iw)));
  const height = Math.max(8, Math.min(ih - top, Math.round(box.h * ih)));
  return sharp(image).extract({ left, top, width, height }).toBuffer();
}

const HEX_BITS: Record<string, number> = {};
for (let i = 0; i < 16; i++) {
  HEX_BITS[i.toString(16)] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);
}

export function distance(a: string, b: string): number {
  if (a.length !== b.length) return HASH_BITS;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += HEX_BITS[(parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(16)] ?? 4;
  }
  return d;
}

// Every correct identification in the measurement scored 77 or better and
// beat its runner-up by a quarter or more. The tile that was missed scored
// 109 and was a hair from its runner-up — a flat field, which is what "not
// this one" looks like. Both bars have to be cleared.
const MAX_DISTANCE = 90;
const MAX_RATIO = 0.8;

export type Candidate = { id: string; requestId: string; hash: string };
export type Verdict =
  | { kind: "match"; candidate: Candidate; distance: number; ratio: number }
  | { kind: "unsure"; distance: number; ratio: number };

/**
 * Which cut this tile is — or a refusal.
 *
 * Nothing is returned unless the best candidate is both close in absolute
 * terms and clearly ahead of the next one. A tile we cannot place is worth
 * far more as a gap than as a plausible wrong answer: the whole reason this
 * was rebuilt is that the old matching always produced something.
 */
export function identify(tileHash: string, pool: Candidate[]): Verdict {
  if (pool.length === 0) return { kind: "unsure", distance: HASH_BITS, ratio: 1 };

  let best: Candidate | null = null;
  let bestD = Infinity;
  let secondD = Infinity;
  for (const c of pool) {
    const d = distance(tileHash, c.hash);
    if (d < bestD) {
      secondD = bestD;
      bestD = d;
      best = c;
    } else if (d < secondD) {
      secondD = d;
    }
  }

  const ratio = secondD === Infinity ? 0 : bestD / secondD;
  if (!best || bestD > MAX_DISTANCE || ratio > MAX_RATIO) {
    return { kind: "unsure", distance: bestD, ratio };
  }
  return { kind: "match", candidate: best, distance: bestD, ratio };
}

/**
 * The hook text burned into the video, reduced to something comparable.
 *
 * This is the second opinion for tiles the picture can't settle. The text
 * is rendered into the clip by the editor, so it survives a different cover
 * frame and a tighter crop — exactly the case that defeated the hash — and
 * two reels sharing a sentence is far less likely than two reels sharing a
 * room and an outfit.
 */
export function normaliseText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 0…1, where 1 is identical. Cheap edit distance over words and letters. */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        carry + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      carry = t;
    }
  }
  return prev[b.length];
}

// Read off a photograph of a screen, so a few wrong letters are expected.
// Short strings are excluded outright — "hi" matching "hi" means nothing.
const MIN_TEXT_LENGTH = 12;
const MIN_TEXT_SIMILARITY = 0.82;
const TEXT_RUNNER_UP_GAP = 0.08;

export type TextCandidate = { id: string; requestId: string; text: string };

/** Same contract as identify(): a single clear answer, or nothing. */
export function identifyByText(
  tileText: string | null,
  pool: TextCandidate[]
): { candidate: TextCandidate; score: number } | null {
  const needle = normaliseText(tileText);
  if (needle.length < MIN_TEXT_LENGTH) return null;

  let best: TextCandidate | null = null;
  let bestS = 0;
  let secondS = 0;
  for (const c of pool) {
    const hay = normaliseText(c.text);
    if (hay.length < MIN_TEXT_LENGTH) continue;
    const s = textSimilarity(needle, hay);
    if (s > bestS) {
      secondS = bestS;
      bestS = s;
      best = c;
    } else if (s > secondS) {
      secondS = s;
    }
  }

  if (!best || bestS < MIN_TEXT_SIMILARITY) return null;
  // Two cuts of one job often carry the same hook. If the second is nearly
  // as good, the text does not identify anything on its own.
  if (bestS - secondS < TEXT_RUNNER_UP_GAP) return null;
  return { candidate: best, score: bestS };
}

/**
 * The n nearest candidates, decisive or not.
 *
 * When identify() refuses, the answer is usually still near the top of the
 * list — Posing #29 sat at rank 12 of 122 in a case the hash could not
 * settle. That makes a poor verdict a good shortlist, which is what the
 * final look is given instead of the whole vault.
 */
export function shortlist(tileHash: string, pool: Candidate[], n: number): Candidate[] {
  return pool
    .map((c) => ({ c, d: distance(tileHash, c.hash) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
}
