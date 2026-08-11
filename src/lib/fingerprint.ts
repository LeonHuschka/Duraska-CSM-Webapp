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
  // Re-encoded at the default quality, a crop of a photographed screen
  // loses exactly the fine detail the landmarks are looking for.
  return sharp(image)
    .extract({ left, top, width, height })
    .jpeg({ quality: 95 })
    .toBuffer();
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
  const cols = lines(present.map((b) => b.x + b.w / 2), w * 0.5);
  const rows = lines(present.map((b) => b.y + b.h / 2), h * 0.5);

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
 * Find the grid's true edges in the picture, using the model only for scale.
 *
 * Snapping to a lattice removes the scatter between boxes but not a shift
 * they all share — and they did all share one: every crop sat a fifth of a
 * tile too low, so each contained the bottom of one reel and the top of the
 * next. No amount of averaging fixes a common offset.
 *
 * The picture knows where the edges are. Tile borders are where brightness
 * changes abruptly right across the image, so the spacing comes from the
 * boxes and the position comes from wherever that change actually is.
 */
export async function refineGrid(
  image: Buffer,
  boxes: (Box | null)[]
): Promise<(Box | null)[]> {
  const snapped = snapToGrid(boxes);
  const present = snapped.filter((b): b is Box => b !== null);
  if (present.length < 2) return snapped;

  const meta = await sharp(image).metadata();
  const IW = meta.width ?? 0;
  const IH = meta.height ?? 0;
  if (!IW || !IH) return snapped;

  // Search only where the boxes say the grid is. Across the whole picture
  // the strongest edges belong to the app's own toolbar, not to any tile
  // border — an earlier attempt aligned the tiles to the buttons.
  const pad = 0.06;
  const x0 = Math.max(0, Math.round((Math.min(...present.map((b) => b.x)) - pad) * IW));
  const x1 = Math.min(IW, Math.round((Math.max(...present.map((b) => b.x + b.w)) + pad) * IW));
  const y0 = Math.max(0, Math.round((Math.min(...present.map((b) => b.y)) - pad) * IH));
  const y1 = Math.min(IH, Math.round((Math.max(...present.map((b) => b.y + b.h)) + pad) * IH));
  if (x1 - x0 < 32 || y1 - y0 < 32) return snapped;

  const { data, info } = await sharp(image)
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rw = info.width;
  const rh = info.height;

  const rowEnergy = new Float64Array(Math.max(1, rh - 1));
  const colEnergy = new Float64Array(Math.max(1, rw - 1));
  for (let y = 0; y < rh - 1; y++) {
    let acc = 0;
    const o = y * rw;
    const o2 = (y + 1) * rw;
    for (let x = 0; x < rw; x++) acc += Math.abs(data[o2 + x] - data[o + x]);
    rowEnergy[y] = acc;
  }
  for (let y = 0; y < rh; y++) {
    const o = y * rw;
    for (let x = 0; x < rw - 1; x++) colEnergy[x] += Math.abs(data[o + x + 1] - data[o + x]);
  }

  const w = present[0].w;
  const h = present[0].h;

  /** Slide the predicted borders over one period; keep the best placement. */
  const bestShift = (energy: Float64Array, size: number, centres: number[], origin: number, span: number) => {
    const pitch = size * (energy === rowEnergy ? IH : IW);
    if (!(pitch > 4)) return 0;
    let best = 0;
    let bestScore = -1;
    const step = Math.max(1, Math.round(pitch / 60));
    for (let sft = -Math.round(pitch / 2); sft <= Math.round(pitch / 2); sft += step) {
      let score = 0;
      for (const c of centres) {
        const abs = c * span;
        for (const edge of [abs - pitch / 2 + sft - origin, abs + pitch / 2 + sft - origin]) {
          const i = Math.round(edge);
          if (i < 1 || i >= energy.length) continue;
          score += energy[i - 1] + energy[i] + energy[i + 1 < energy.length ? i + 1 : i];
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = sft;
      }
    }
    return best / (energy === rowEnergy ? IH : IW);
  };

  const uniq = (vs: number[], tol: number) => {
    const s2 = [...vs].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of s2) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  };
  const cols = uniq(present.map((b) => b.x + b.w / 2), w * 0.5);
  const rows = uniq(present.map((b) => b.y + b.h / 2), h * 0.5);

  const dx = bestShift(colEnergy, w, cols, x0, IW);
  const dy = bestShift(rowEnergy, h, rows, y0, IH);

  return snapped.map((b) =>
    b === null
      ? null
      : {
          x: Math.max(0, Math.min(1 - b.w, b.x + dx)),
          y: Math.max(0, Math.min(1 - b.h, b.y + dy)),
          w: b.w,
          h: b.h,
        }
  );
}
