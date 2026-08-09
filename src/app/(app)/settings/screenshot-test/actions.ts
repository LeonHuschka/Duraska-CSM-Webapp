"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { extractMetricsFromImage, matchTilesToCandidates } from "@/lib/vision";
import {
  fingerprint,
  cropTile,
  identify,
  identifyByText,
  shortlist,
  distance,
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
    method: "image" | "text" | "looked";
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
 * Run a screenshot through the exact path the Telegram handler uses, and
 * report every step.
 *
 * The point is that the layout is not ours to control: each VA screenshots
 * a different surface, and hiring the next one changes it again. Nothing
 * here assumes a grid shape — the tiles are located by the model and
 * identified by their picture — so the only way to know a new format works
 * is to run one through and look. This is that.
 */
export async function analyseScreenshot(form: FormData) {
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
    .select("id, request_id, phash, overlay_text, thumbnail_path")
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
  const thumbOf = new Map<string, string>();
  for (const c of cuts ?? []) {
    if (!c.id || !c.request_id) continue;
    if (!titles.has(c.request_id)) continue; // another persona's cut
    if (c.phash) hashPool.push({ id: c.id, requestId: c.request_id, hash: c.phash });
    if (c.overlay_text) {
      textPool.push({ id: c.id, requestId: c.request_id, text: c.overlay_text });
    }
    if (c.thumbnail_path) thumbOf.set(c.id, c.thumbnail_path);
  }

  const tiles: TileResult[] = [];
  let lastStage: { tiles: number; candidates: number; error: string | null } | null = null;
  const taken = new Set<string>();
  const wantThumbs = new Set<string>();
  const unresolved: { position: number; crop: Buffer; hash: string }[] = [];

  for (const r of metrics.reels) {
    const row: TileResult = {
      position: r.position,
      views: r.views,
      caption: r.caption,
      box: r.box,
      crop: null,
      match: null,
      nearest: null,
      closest: [],
    };

    let tileCrop: Buffer | null = null;
    let tileHash: string | null = null;

    if (r.box) {
      try {
        const tile = await cropTile(buf, r.box);
        tileCrop = tile;
        // Small enough to inline, big enough to see what was cut out.
        row.crop = `data:image/jpeg;base64,${tile.toString("base64")}`;
        tileHash = await fingerprint(tile);
        row.closest = shortlist(tileHash, hashPool, 3).map((c) => ({
          title: titles.get(c.requestId) ?? "—",
          distance: distance(tileHash!, c.hash),
        }));
        const verdict = identify(
          tileHash,
          hashPool.filter((c) => !taken.has(c.id))
        );
        if (verdict.kind === "match") {
          const t = thumbOf.get(verdict.candidate.id);
          if (t) wantThumbs.add(t);
          row.match = {
            title: titles.get(verdict.candidate.requestId) ?? "—",
            method: "image",
            explain: `by picture — ${verdict.distance} bits apart, ${Math.round(
              verdict.ratio * 100
            )}% of the runner-up`,
            thumb: t ?? null,
          };
          taken.add(verdict.candidate.id);
        } else {
          row.nearest = {
            title: "closest was not decisive",
            distance: verdict.distance,
            ratio: verdict.ratio,
          };
        }
      } catch (err) {
        row.nearest = {
          title: err instanceof Error ? err.message : "crop failed",
          distance: -1,
          ratio: -1,
        };
      }
    }

    if (!row.match) {
      const byText = identifyByText(
        r.caption,
        textPool.filter((c) => !taken.has(c.id))
      );
      if (byText) {
        const t = thumbOf.get(byText.candidate.id);
        if (t) wantThumbs.add(t);
        row.match = {
          title: titles.get(byText.candidate.requestId) ?? "—",
          method: "text",
          explain: `by text — ${Math.round(byText.score * 100)}% alike`,
          thumb: t ?? null,
          tileText: r.caption,
          cutText: byText.candidate.text,
        };
        taken.add(byText.candidate.id);
      } else if (tileCrop && tileHash) {
        unresolved.push({ position: r.position, crop: tileCrop, hash: tileHash });
      }
    }

    tiles.push(row);
  }

  // The final look, on a shortlist the hash ranked rather than decided.
  if (unresolved.length > 0 && hashPool.length > 0) {
    const union: Candidate[] = [];
    const seen = new Set<string>();
    for (const u of unresolved) {
      for (const c of shortlist(u.hash, hashPool.filter((c) => !taken.has(c.id)), 8)) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          union.push(c);
        }
      }
    }
    const paths = union.map((c) => thumbOf.get(c.id)).filter((p): p is string => !!p);
    const { data: signedThumbs } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(paths, 600);
    const urlFor = new Map<string, string>();
    for (const s of signedThumbs ?? []) {
      if (s.path && s.signedUrl) urlFor.set(s.path, s.signedUrl);
    }
    const kept: Candidate[] = [];
    const thumbs: { base64: string; mime: string }[] = [];
    for (const c of union) {
      const path = thumbOf.get(c.id);
      const url = path ? urlFor.get(path) : undefined;
      if (!url) continue;
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        thumbs.push({
          base64: Buffer.from(await r.arrayBuffer()).toString("base64"),
          mime: "image/jpeg",
        });
        kept.push(c);
      } catch {
        // not offered
      }
    }
    lastStage = { tiles: unresolved.length, candidates: kept.length, error: null };
    if (kept.length > 0) {
      const { data: verdicts, error: lerr } = await matchTilesToCandidates(
        unresolved.map((u) => ({
          position: u.position,
          base64: u.crop.toString("base64"),
          mime: "image/jpeg",
        })),
        thumbs
      );
      if (lerr) lastStage.error = lerr;
      for (const v of verdicts ?? []) {
        if (v.candidate === null) continue;
        const c = kept[v.candidate - 1];
        if (!c || taken.has(c.id)) continue;
        const row = tiles.find((t) => t.position === v.position);
        if (!row || row.match) continue;
        const t = thumbOf.get(c.id);
        if (t) wantThumbs.add(t);
        row.match = {
          title: titles.get(c.requestId) ?? "—",
          method: "looked",
          explain: `by looking — ${Math.round(v.confidence * 100)}% sure, from a shortlist of ${kept.length}`,
          thumb: t ?? null,
        };
        taken.add(c.id);
      }
    }
  }

  // One signing call for every thumbnail we are about to show.
  if (wantThumbs.size) {
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(Array.from(wantThumbs), 900);
    const url = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
    }
    for (const t of tiles) {
      if (t.match?.thumb) t.match.thumb = url.get(t.match.thumb) ?? null;
    }
  }

  return {
    error: null,
    kind: metrics.metric_kind,
    handle: metrics.handle,
    followers: metrics.followers,
    confidence: metrics.confidence,
    poolSize: hashPool.length,
    textPoolSize: textPool.length,
    lastStage,
    tiles,
  };
}
