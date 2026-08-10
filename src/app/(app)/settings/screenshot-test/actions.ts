"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { extractMetricsFromImage } from "@/lib/vision";
import {
  describe,
  identifyByLandmarks,
  TILE_FEATURES,
  SCAN_FEATURES,
  type LandmarkCandidate,
} from "@/lib/orb";
import {
  fingerprint,
  cropTile,
  identify,
  identifyByText,
  shortlist,
  distance,
  refineGrid,
  type Candidate,
  type TextCandidate,
} from "@/lib/fingerprint";

export type TileResult = {
  position: number;
  views: number | null;
  caption: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  crop: string | null;
  match: {
    title: string;
    method: "landmarks" | "image" | "text" | "looked";
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
  const personaId = await requireActivePersonaId();
  const supabase = await createClient();

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

  const { data: cuts } = await supabase
    .from("content_assets")
    .select("id, request_id, phash, orb_index, orb_count, overlay_text, thumbnail_path")
    .eq("stage", "edited")
    .not("phash", "is", null);

  const requestIds = Array.from(
    new Set((cuts ?? []).map((c) => c.request_id).filter(Boolean) as string[])
  );
  const titles = new Map<string, string>();
  if (requestIds.length) {
    const { data: reqs } = await supabase
      .from("content_requests")
      .select("id, title")
      .eq("persona_id", personaId)
      .in("id", requestIds);
    for (const r of reqs ?? []) titles.set(r.id, r.title);
  }

  const hashPool: Candidate[] = [];
  const landmarks = new Map<string, LandmarkCandidate>();
  const textPool: TextCandidate[] = [];
  const thumbOf = new Map<string, string>();
  for (const c of cuts ?? []) {
    if (!c.id || !c.request_id) continue;
    if (!titles.has(c.request_id)) continue; // another persona's cut
    if (c.phash) hashPool.push({ id: c.id, requestId: c.request_id, hash: c.phash });
    if (c.overlay_text) {
      textPool.push({ id: c.id, requestId: c.request_id, text: c.overlay_text });
    }
    if (c.thumbnail_path) thumbOf.set(c.id, c.thumbnail_path);
    if (c.orb_index && c.orb_count) {
      landmarks.set(c.id, {
        id: c.id,
        requestId: c.request_id,
        index: { count: c.orb_count, data: Buffer.from(c.orb_index, "base64") },
      });
    }
  }


  const boxes = await refineGrid(buf, metrics.reels.map((r) => r.box));
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
    kind: metrics.metric_kind,
    handle: metrics.handle,
    followers: metrics.followers,
    confidence: metrics.confidence,
    tiles: cut,
  };
}

/**
 * Step two: say which cut each tile shows.
 *
 * Called a few tiles at a time so each call stays well inside its minute.
 * Landmarks decide first — they are the only stage that survives a crop —
 * then the hash, then the hook text. Every stage may refuse, and refusing is
 * the default.
 */
export async function identifyTiles(input: {
  tiles: { position: number; caption: string | null; crop: string | null }[];
  taken: string[];
}) {
  const personaId = await requireActivePersonaId();
  const supabase = await createClient();

  const { data: cuts } = await supabase
    .from("content_assets")
    .select("id, request_id, phash, orb_index, orb_count, overlay_text, thumbnail_path")
    .eq("stage", "edited")
    .not("phash", "is", null);

  const requestIds = Array.from(
    new Set((cuts ?? []).map((c) => c.request_id).filter(Boolean) as string[])
  );
  const titles = new Map<string, string>();
  if (requestIds.length) {
    const { data: reqs } = await supabase
      .from("content_requests")
      .select("id, title")
      .eq("persona_id", personaId)
      .in("id", requestIds);
    for (const r of reqs ?? []) titles.set(r.id, r.title);
  }

  const hashPool: Candidate[] = [];
  const textPool: TextCandidate[] = [];
  const landmarks = new Map<string, LandmarkCandidate>();
  const thumbOf = new Map<string, string>();
  for (const c of cuts ?? []) {
    if (!c.id || !c.request_id || !titles.has(c.request_id)) continue;
    if (c.phash) hashPool.push({ id: c.id, requestId: c.request_id, hash: c.phash });
    if (c.overlay_text) textPool.push({ id: c.id, requestId: c.request_id, text: c.overlay_text });
    if (c.thumbnail_path) thumbOf.set(c.id, c.thumbnail_path);
    if (c.orb_index && c.orb_count) {
      landmarks.set(c.id, {
        id: c.id,
        requestId: c.request_id,
        index: { count: c.orb_count, data: Buffer.from(c.orb_index, "base64") },
      });
    }
  }

  const taken = new Set(input.taken);
  const out: TileResult[] = [];
  const wantThumbs = new Set<string>();

  for (const t of input.tiles) {
    const row: TileResult = {
      position: t.position,
      views: null,
      caption: t.caption,
      box: null,
      crop: null,
      match: null,
      nearest: null,
      closest: [],
    };
    if (!t.crop) {
      row.nearest = { title: "no tile was cut out", distance: -1, ratio: -1 };
      out.push(row);
      continue;
    }

    // Hand the cut-out back so the page can show what was actually
    // compared. Splitting the work dropped it, and a verdict you cannot see
    // the input of is not checkable.
    row.crop = `data:image/jpeg;base64,${t.crop}`;

    const tile = Buffer.from(t.crop, "base64");
    const tileHash = await fingerprint(tile);
    row.closest = shortlist(tileHash, hashPool, 3).map((c) => ({
      title: titles.get(c.requestId) ?? "—",
      distance: distance(tileHash, c.hash),
    }));

    // Landmarks first, and over every cut — not over a shortlist the hash
    // picked, which is what hid the right answer on exactly the tiles this
    // was built for.
    const open = Array.from(landmarks.values()).filter((c) => !taken.has(c.id));
    if (open.length > 0) {
      const scan = await describe(tile, SCAN_FEATURES);
      const idx = scan ? await describe(tile, TILE_FEATURES) : null;
      if (scan && idx) {
        const v = await identifyByLandmarks(scan, idx, open);
        if (v.kind === "match") {
          const th = thumbOf.get(v.candidate.id);
          if (th) wantThumbs.add(th);
          row.match = {
            title: titles.get(v.candidate.requestId) ?? "—",
            method: "landmarks",
            explain: `by landmarks — ${v.shared} shared, ${v.lead.toFixed(1)}× the runner-up`,
            thumb: th ?? null,
          };
          taken.add(v.candidate.id);
          out.push(row);
          continue;
        }
        // Kept even when the cheaper stages run after it: this is the
        // number that explains the refusal, and the hash's own verdict
        // would otherwise paper over it.
        row.nearest = { title: "landmarks not decisive", distance: v.shared, ratio: v.lead };
      }
    }

    const landmarkNearest = row.nearest;
    const verdict = identify(tileHash, hashPool.filter((c) => !taken.has(c.id)));
    if (verdict.kind === "match") {
      const th = thumbOf.get(verdict.candidate.id);
      if (th) wantThumbs.add(th);
      row.match = {
        title: titles.get(verdict.candidate.requestId) ?? "—",
        method: "image",
        explain: `by picture — ${verdict.distance} bits apart, ${Math.round(verdict.ratio * 100)}% of the runner-up`,
        thumb: th ?? null,
      };
      taken.add(verdict.candidate.id);
      out.push(row);
      continue;
    }

    row.nearest = landmarkNearest ?? row.nearest;
    const byText = identifyByText(t.caption, textPool.filter((c) => !taken.has(c.id)));
    if (byText) {
      const th = thumbOf.get(byText.candidate.id);
      if (th) wantThumbs.add(th);
      row.match = {
        title: titles.get(byText.candidate.requestId) ?? "—",
        method: "text",
        explain: `by text — ${Math.round(byText.score * 100)}% alike`,
        thumb: th ?? null,
        tileText: t.caption,
        cutText: byText.candidate.text,
      };
      taken.add(byText.candidate.id);
    }
    out.push(row);
  }

  if (wantThumbs.size) {
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(Array.from(wantThumbs), 900);
    const url = new Map<string, string>();
    for (const s of signed ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
    for (const r of out) if (r.match?.thumb) r.match.thumb = url.get(r.match.thumb) ?? null;
  }

  return {
    error: null,
    tiles: out,
    taken: Array.from(taken),
    // How each verdict was reached, so one run says which stage is carrying
    // the work and which is dead weight.
    byMethod: {
      landmarks: out.filter((r) => r.match?.method === "landmarks").length,
      image: out.filter((r) => r.match?.method === "image").length,
      text: out.filter((r) => r.match?.method === "text").length,
    },
    poolSize: hashPool.length,
    landmarkPool: landmarks.size,
    textPoolSize: textPool.length,
  };
}
