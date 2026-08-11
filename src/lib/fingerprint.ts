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
  // The nearest is carried even when it is not trusted: it becomes a
  // proposal for someone to confirm, which is worth more than a blank.
  | { kind: "unsure"; distance: number; ratio: number; best: Candidate | null };

/**
 * Which cut this tile is — or a refusal.
 *
 * Nothing is returned unless the best candidate is both close in absolute
 * terms and clearly ahead of the next one. A tile we cannot place is worth
 * far more as a gap than as a plausible wrong answer: the whole reason this
 * was rebuilt is that the old matching always produced something.
 */
export function identify(tileHash: string, pool: Candidate[]): Verdict {
  if (pool.length === 0) return { kind: "unsure", distance: HASH_BITS, ratio: 1, best: null };

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
    return { kind: "unsure", distance: bestD, ratio, best };
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

export type Box = { x: number; y: number; w: number; h: number };

/**
 * Straighten the tile boxes against the grid they came from.
 *
 * Asked for nine rectangles, a model gives nine roughly-right rectangles —
 * each off by a little, in its own direction. Cropping on those produced
 * slivers and fragments spanning two tiles, and the fingerprint was then
 * being asked to recognise something that was never a reel.
 *
 * But a profile grid is a lattice, and that is information the individual
 * guesses throw away. Columns and rows are recovered from the guesses as a
 * whole, and every tile is rebuilt from the lattice: one consistent size,
 * and edges that agree with their neighbours.
 */
export function snapToGrid(boxes: (Box | null)[]): (Box | null)[] {
  const present = boxes.filter((b): b is Box => b !== null);
  if (present.length < 3) return boxes; // too few to infer anything

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const w = med(present.map((b) => b.w));
  const h = med(present.map((b) => b.h));
  if (!(w > 0) || !(h > 0)) return boxes;

  // Group centres that sit within half a tile of each other; the group's
  // median is the true column or row line.
  const lines = (values: number[], tolerance: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const v of sorted) {
      const last = groups[groups.length - 1];
      if (last && v - last[last.length - 1] <= tolerance) last.push(v);
      else groups.push([v]);
    }
    return groups.map(med);
  };
  /**
   * Force the lines onto one ladder.
   *
   * Grouping them independently leaves a row that was guessed badly sitting
   * where it was guessed — which is how two tiles of one screenshot came
   * back cut across their neighbours while the rest were perfect. A grid has
   * one spacing, so the spacing is measured once and every line is placed by
   * it, from the row that agrees with the others.
   */
  const regular = (ls: number[]) => {
    if (ls.length < 3) return ls;
    const gaps = ls.slice(1).map((v, i) => v - ls[i]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const pitch = sorted[Math.floor(sorted.length / 2)];
    if (!(pitch > 0)) return ls;
    // Index each line on the ladder, then take the offset they agree on.
    const idx = ls.map((v) => Math.round((v - ls[0]) / pitch));
    const offsets = ls.map((v, i) => v - idx[i] * pitch);
    const so = [...offsets].sort((a, b) => a - b);
    const origin = so[Math.floor(so.length / 2)];
    return idx.map((i) => origin + i * pitch);
  };

  const cols = regular(lines(present.map((b) => b.x + b.w / 2), w * 0.5));
  const rows = regular(lines(present.map((b) => b.y + b.h / 2), h * 0.5));

  const nearest = (v: number, ls: number[]) =>
    ls.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), ls[0]);

  return boxes.map((b) => {
    if (!b) return null;
    const cx = nearest(b.x + b.w / 2, cols);
    const cy = nearest(b.y + b.h / 2, rows);
    const snapped = {
      x: Math.max(0, Math.min(1 - w, cx - w / 2)),
      y: Math.max(0, Math.min(1 - h, cy - h / 2)),
      w,
      h,
    };
    // If snapping moved a tile more than half its own size, the lattice
    // does not describe this box — keep what the model said rather than
    // inventing a location for it.
    const moved = Math.hypot(snapped.x - b.x, snapped.y - b.y);
    return moved > Math.max(w, h) * 0.5 ? b : snapped;
  });
}

/**
 * Read the grid out of the picture, using the model only for scale.
 *
 * Asked for nine rectangles a model returns nine roughly-right ones, and
 * repairing them was a losing game: straightening them against each other
 * left a badly guessed row where it was guessed, and forcing them onto a
 * common ladder fixed that row by moving the good ones. Tiles kept coming
 * back cut across their neighbours.
 *
 * A grid, though, draws regular edges right across the picture. Their
 * spacing and their position can be read from the picture itself, and the
 * only thing still taken from the model is roughly how big a tile is —
 * which it estimates well even when it puts the tile in the wrong place,
 * and which keeps the search off harmonics.
 *
 * Measured against hand-measured tile positions on two photographed
 * screens: rows land within 6–7px and columns within 1–5px, on tiles of
 * 190×330 and 276×388.
 */
export async function refineGrid(
  image: Buffer,
  boxes: (Box | null)[]
): Promise<(Box | null)[]> {
  const present = boxes.filter((b): b is Box => b !== null);
  if (present.length < 2) return boxes;

  const meta = await sharp(image).metadata();
  const IW = meta.width ?? 0;
  const IH = meta.height ?? 0;
  if (!IW || !IH) return boxes;

  const { data, info } = await sharp(image)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // How much the picture changes stepping down, and stepping across.
  const rowEnergy = new Float64Array(h - 1);
  const colEnergy = new Float64Array(w - 1);
  for (let y = 0; y < h - 1; y++) {
    let acc = 0;
    const o = y * w;
    const o2 = (y + 1) * w;
    for (let x = 0; x < w; x++) acc += Math.abs(data[o2 + x] - data[o + x]);
    rowEnergy[y] = acc;
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w - 1; x++) {
      colEnergy[x] += Math.abs(data[o + x + 1] - data[o + x]);
    }
  }

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const guessH = Math.round(med(present.map((b) => b.h)) * IH);
  const guessW = Math.round(med(present.map((b) => b.w)) * IW);

  /** The spacing that repeats, searched only near the size we expect. */
  const pitchNear = (sig: Float64Array, guess: number) => {
    const lo = Math.max(8, Math.round(guess * 0.7));
    const hi = Math.min(sig.length - 1, Math.round(guess * 1.3));
    if (hi <= lo) return guess;
    let mean = 0;
    for (let i = 0; i < sig.length; i++) mean += sig[i];
    mean /= sig.length;
    let best = guess;
    let bestScore = -Infinity;
    for (let lag = lo; lag < hi; lag++) {
      let acc = 0;
      for (let i = 0; i + lag < sig.length; i++) {
        acc += (sig[i] - mean) * (sig[i + lag] - mean);
      }
      if (acc > bestScore) {
        bestScore = acc;
        best = lag;
      }
    }
    return best;
  };

  /** Where the ladder starts: the offset landing borders on real edges. */
  const phaseFor = (sig: Float64Array, pitch: number) => {
    let best = 0;
    let bestScore = -1;
    for (let off = 0; off < pitch; off++) {
      let acc = 0;
      let n = 0;
      for (let i = off; i < sig.length; i += pitch) {
        acc += sig[i];
        n++;
      }
      const score = n > 0 ? acc / n : 0;
      if (score > bestScore) {
        bestScore = score;
        best = off;
      }
    }
    return best;
  };

  const pitchY = pitchNear(rowEnergy, guessH);
  const pitchX = pitchNear(colEnergy, guessW);
  const originY = phaseFor(rowEnergy, pitchY);
  const originX = phaseFor(colEnergy, pitchX);

  // A hair inside the cell, so a neighbour's edge never bleeds in.
  const inset = 0.02;
  return boxes.map((b) => {
    if (!b) return null;
    const cy = (b.y + b.h / 2) * IH;
    const cx = (b.x + b.w / 2) * IW;
    const row = Math.max(0, Math.round((cy - originY - pitchY / 2) / pitchY));
    const col = Math.max(0, Math.round((cx - originX - pitchX / 2) / pitchX));
    const top = originY + row * pitchY;
    const left = originX + col * pitchX;
    return {
      x: Math.max(0, Math.min(1, (left + pitchX * inset) / IW)),
      y: Math.max(0, Math.min(1, (top + pitchY * inset) / IH)),
      w: Math.min(1, (pitchX * (1 - 2 * inset)) / IW),
      h: Math.min(1, (pitchY * (1 - 2 * inset)) / IH),
    };
  });
}
