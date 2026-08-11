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
 * Rebuild the tiles on one ladder, sized by the model and placed by vote.
 *
 * Three approaches failed before this one, and each failed for the same
 * reason: they trusted something they should not have. Straightening the
 * model's rectangles against each other left a badly guessed row where it
 * was guessed. Forcing them onto a shared ladder fixed that row by moving
 * the good ones. Reading the spacing out of the picture locked onto the
 * app's own toolbar, whose edges are stronger than any tile border.
 *
 * What the model is reliably right about is size — a tile's width and
 * height, even when it puts the tile in the wrong place. A grid is even, so
 * size gives the spacing, and the position is then whatever most of the
 * rows agree on. A row guessed badly implies a different starting point
 * from all the others and is simply outvoted.
 *
 * If the result disagrees with the model by more than half a tile, the
 * model's own box is kept: the worst case is then what it was before this
 * function existed, rather than something worse.
 */
export async function refineGrid(
  image: Buffer,
  boxes: (Box | null)[]
): Promise<(Box | null)[]> {
  const present = boxes.filter((b): b is Box => b !== null);
  if (present.length < 4) return boxes;

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const w = med(present.map((b) => b.w));
  const h = med(present.map((b) => b.h));

  /** How many distinct lines the centres fall on. */
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
  const colLines = lines(present.map((b) => b.x + b.w / 2), w * 0.5);
  const rowLines = lines(present.map((b) => b.y + b.h / 2), h * 0.5);
  if (colLines.length < 1 || rowLines.length < 1) return boxes;

  // Spacing comes from the tile size, not from the region: a single row
  // displaced far enough drags the region's edge with it and corrupts the
  // spacing too, which then compounds across every row after it. Size is
  // the one thing the model estimates well.
  const pitchX = w;
  const pitchY = h;

  /**
   * Where the ladder starts, decided by vote.
   *
   * Each line implies an origin. A line that was guessed badly implies a
   * wrong one and is outvoted by the rest — which is exactly the failure
   * that kept cutting tiles across their neighbours.
   */
  const originFrom = (centres: number[], pitch: number) =>
    med(centres.map((c, i) => c - i * pitch - pitch / 2));
  const left = originFrom(colLines, pitchX);
  const top = originFrom(rowLines, pitchY);
  if (!(pitchX > 0) || !(pitchY > 0)) return boxes;

  // A hair inside the cell, so a neighbour never bleeds in.
  const inset = 0.03;
  return boxes.map((b) => {
    if (!b) return null;
    const col = Math.max(
      0,
      Math.min(colLines.length - 1, Math.round((b.x + b.w / 2 - left - pitchX / 2) / pitchX))
    );
    const row = Math.max(
      0,
      Math.min(rowLines.length - 1, Math.round((b.y + b.h / 2 - top - pitchY / 2) / pitchY))
    );
    const cell = {
      x: left + col * pitchX + pitchX * inset,
      y: top + row * pitchY + pitchY * inset,
      w: pitchX * (1 - 2 * inset),
      h: pitchY * (1 - 2 * inset),
    };
    const moved = Math.hypot(cell.x - b.x, cell.y - b.y);
    return moved > Math.max(pitchX, pitchY) * 0.5 ? b : cell;
  });
}
