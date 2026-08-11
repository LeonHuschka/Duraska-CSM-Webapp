import sharp from "sharp";

/**
 * Find the tiles of a profile grid in a screenshot.
 *
 * No model is involved. Five earlier attempts asked one for nine rectangles
 * and then tried to repair the answer; the rectangles came back a tile and a
 * half wide and displaced, and no amount of averaging, laddering or snapping
 * made them usable.
 *
 * A grid has four unknowns — how wide a column is, how tall a row is, and
 * where the lattice starts — and all four can be read out of the picture. A
 * comb of evenly spaced lines is slid over the edge energy and placed where
 * most of its lines land on real borders. A comb fits no toolbar; only a
 * grid. An earlier attempt looked for single strong lines and found the
 * app's buttons, which is a different question with a different answer.
 *
 * Measured against hand-measured tile positions on four screenshots of two
 * different surfaces, photographed off a phone screen: columns land within
 * 1–5px and rows within 8–10px, on tiles of about 190×345 and 277×371.
 */

export type Cell = { x: number; y: number; w: number; h: number };

// Everything is measured at this width. Bigger buys no accuracy here and
// costs time in the two searches below.
const WORK_WIDTH = 720;

export async function findGrid(image: Buffer): Promise<Cell[]> {
  const { data, info } = await sharp(image)
    .greyscale()
    .resize(WORK_WIDTH, null)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (w < 60 || h < 60) return [];

  const at = (x: number, y: number) => data[y * w + x];

  // How much the picture changes stepping across, and stepping down.
  const colEdge = new Float64Array(Math.max(1, w - 1));
  const rowEdge = new Float64Array(Math.max(1, h - 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) colEdge[x] += Math.abs(at(x + 1, y) - at(x, y));
  }
  for (let y = 0; y < h - 1; y++) {
    let acc = 0;
    for (let x = 0; x < w; x++) acc += Math.abs(at(x, y + 1) - at(x, y));
    rowEdge[y] = acc;
  }

  const comb = (sig: Float64Array, origin: number, pitch: number, n: number) => {
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(origin + i * pitch);
      if (x >= 1 && x < sig.length - 1) s += sig[x - 1] + sig[x] + sig[x + 1];
    }
    return s / (n + 1);
  };

  // Three columns, so four borders. Trying every spacing and every start
  // keeps this off the harmonics that a plain autocorrelation falls into.
  let bestCol = { score: -1, origin: 0, pitch: Math.round(w / 3) };
  for (let pitch = Math.round(w * 0.15); pitch < Math.round(w * 0.45); pitch++) {
    for (let origin = 0; origin + 3 * pitch < w; origin += 2) {
      const s = comb(colEdge, origin, pitch, 3);
      if (s > bestCol.score) bestCol = { score: s, origin, pitch };
    }
  }

  // Rows: the height sits between one and two column widths — 3:4 tiles at
  // 1.33, 9:16 at 1.78 — so both surfaces are covered without being told
  // which one this is.
  let bestRow = { score: -1, origin: 0, pitch: bestCol.pitch };
  for (let pitch = bestCol.pitch; pitch < bestCol.pitch * 2; pitch++) {
    for (let origin = 0; origin < pitch; origin += 2) {
      let s = 0;
      let n = 0;
      for (let i = 1; i < 8; i++) {
        const y = origin + i * pitch;
        if (y >= 1 && y < rowEdge.length - 1) {
          s += rowEdge[y - 1] + rowEdge[y] + rowEdge[y + 1];
          n++;
        }
      }
      if (n >= 3 && s / n > bestRow.score) bestRow = { score: s / n, origin, pitch };
    }
  }

  const gx0 = bestCol.origin;
  const gx1 = Math.min(w, bestCol.origin + 3 * bestCol.pitch);

  // Per row: how much picture there is, and how bright it is — both measured
  // only inside the grid's own columns, because what lies beside a
  // photographed phone is a dark room and says nothing.
  const busy = new Float64Array(h);
  const bright = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let x = gx0; x < gx1; x++) {
      const v = at(x, y);
      sum += v;
      sumSq += v * v;
      n++;
    }
    const mean = n ? sum / n : 0;
    bright[y] = mean;
    busy[y] = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
  }

  const sorted = Array.from(busy).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.85)] || 1;

  const bandMean = (sig: Float64Array, top: number, a: number, b: number) => {
    const lo = Math.max(0, Math.round(top + bestRow.pitch * a));
    const hi = Math.min(sig.length, Math.round(top + bestRow.pitch * b));
    if (hi - lo < 3) return 0;
    let s = 0;
    for (let i = lo; i < hi; i++) s += sig[i];
    return s / (hi - lo);
  };

  /** A row of tiles is busy across its width; a toolbar is flat with buttons. */
  const isGridRow = (top: number) => bandMean(busy, top, 0.2, 0.8) >= peak * 0.5;

  /**
   * Is the whole tile in the picture, or is its foot cut off?
   *
   * The last row of a phone screenshot often still shows reel in its middle
   * while its lower part is already the navigation bar — which is bright,
   * where reel content is not. Measured across every row of four
   * screenshots, complete rows sat between 68 grey levels darker and 19
   * brighter at the foot than in the middle; the one cut-off row jumped 49.
   */
  const isComplete = (top: number) =>
    bandMean(bright, top, 0.82, 0.99) - bandMean(bright, top, 0.2, 0.8) < 30;

  const candidates: number[] = [];
  for (let i = -1; i < 9; i++) {
    const top = bestRow.origin + i * bestRow.pitch;
    if (top < -bestRow.pitch * 0.1) continue;
    if (top + bestRow.pitch > h + bestRow.pitch * 0.1) continue;
    candidates.push(top);
  }
  const ok = candidates
    .map((top, i) => ({ top, i }))
    .filter(({ top }) => isGridRow(top) && isComplete(top));

  // A grid is contiguous. An accepted row with no accepted neighbour is
  // something else that happened to look busy — a status bar over a dark
  // room produced exactly that.
  let best: number[] = [];
  let run: number[] = [];
  for (let k = 0; k < ok.length; k++) {
    if (k > 0 && ok[k].i - ok[k - 1].i === 1) run.push(ok[k].top);
    else {
      if (run.length > best.length) best = run;
      run = [ok[k].top];
    }
  }
  if (run.length > best.length) best = run;

  const scale = 1 / w;
  const scaleY = 1 / h;
  const cells: Cell[] = [];
  for (const top of best) {
    for (let c = 0; c < 3; c++) {
      cells.push({
        x: (bestCol.origin + c * bestCol.pitch) * scale,
        y: top * scaleY,
        w: bestCol.pitch * scale,
        h: bestRow.pitch * scaleY,
      });
    }
  }
  return cells;
}

/**
 * Cut a cell out and drop whatever of the screen came with it.
 *
 * The lattice sits a few pixels off, so a crop often carries a sliver of
 * what is next to the tile: the tab bar above, the navigation bar below, a
 * gutter, the phone's bezel. Those are not the reel, and every landmark
 * spent on them is a landmark not spent on the reel — which is what decides
 * the close calls.
 *
 * Not a fixed inset: that would throw away real picture on the tiles that
 * were cut correctly. Each edge is walked inward only while it looks
 * foreign, and never further than a small fraction of the tile.
 */
export async function cutCell(image: Buffer, cell: Cell): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  const left = Math.max(0, Math.min(iw - 2, Math.round(cell.x * iw)));
  const top = Math.max(0, Math.min(ih - 2, Math.round(cell.y * ih)));
  const width = Math.max(8, Math.min(iw - left, Math.round(cell.w * iw)));
  const height = Math.max(8, Math.min(ih - top, Math.round(cell.h * ih)));

  const { data, info } = await sharp(image)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // What the tile's own interior looks like.
  const core: number[] = [];
  for (let y = Math.round(h * 0.25); y < h * 0.75; y++) {
    for (let x = Math.round(w * 0.25); x < w * 0.75; x++) core.push(data[y * w + x]);
  }
  core.sort((a, b) => a - b);
  const p = (q: number) => core[Math.floor(core.length * q)] ?? 0;
  const span = Math.max(p(0.95) - p(0.05), 1);
  const mid = core.length ? core[Math.floor(core.length / 2)] : 0;

  const stats = (get: (i: number) => number, n: number) => {
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
  };
  const foreign = (s: { mean: number; sd: number }) =>
    s.sd < span * 0.12 || Math.abs(s.mean - mid) > span * 0.9;

  const cap = 0.12;
  let t = 0;
  while (t < h * cap && foreign(stats((x) => data[t * w + x], w))) t++;
  let b = h;
  while (b > h * (1 - cap) && foreign(stats((x) => data[(b - 1) * w + x], w))) b--;
  let l = 0;
  while (l < w * cap && foreign(stats((y) => data[y * w + l], h))) l++;
  let r = w;
  while (r > w * (1 - cap) && foreign(stats((y) => data[y * w + r - 1], h))) r--;

  if (b - t < h * 0.5 || r - l < w * 0.5) {
    t = 0;
    b = h;
    l = 0;
    r = w;
  }

  return sharp(image)
    .extract({ left: left + l, top: top + t, width: r - l, height: b - t })
    .jpeg({ quality: 95 })
    .toBuffer();
}
