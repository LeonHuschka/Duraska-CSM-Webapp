import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  fingerprint,
  identifyByText,
  shortlist,
  type Candidate,
  type TextCandidate,
} from "@/lib/fingerprint";
import {
  describe,
  identifyByLandmarks,
  TILE_FEATURES,
  type LandmarkCandidate,
  SHORTLIST as HASH_SHORTLIST,
} from "@/lib/orb";

/**
 * Which of our cuts each tile of a screenshot shows.
 *
 * One place, used by the Telegram handler and by the check page, because
 * keeping two of these in step failed: the page was matching by landmarks
 * for hours while the bot was still deciding with a perceptual hash — the
 * method we had already measured as unable to survive a crop.
 *
 * Three stages, each able to refuse:
 *
 *   landmarks  hundreds of small features, compared individually. Survives
 *              a crop and a subject who has moved, because the room does
 *              not move. This is what decides.
 *   text       the hook burnt into the clip, for tiles the picture cannot
 *              settle. About half of the vault carries one.
 *   proposal   when neither is decisive, the best candidate is still
 *              offered — flagged, and without spending the cut.
 *
 * The hash survives only as a sorter. It ranked the right answer no worse
 * than sixth of 122 on tiles in our own shape, which is all a shortlist
 * needs, and comparing all of them would cost ten seconds a tile.
 */

export type TileInput = {
  position: number;
  caption: string | null;
  crop: Buffer | null;
};

export type TileMatch = {
  position: number;
  assetId: string | null;
  requestId: string | null;
  title: string | null;
  method: "landmarks" | "text" | null;
  /** Shared landmarks, or text similarity — whatever decided it. */
  score: number;
  lead: number;
  /** True when this is a proposal for a person to confirm. */
  needsCheck: boolean;
  thumbPath: string | null;
  /** The three nearest by name, so a refusal can be understood. */
  closest: { title: string; score: number }[];
};

export type MatchResult = {
  tiles: TileMatch[];
  /** Ids spent by confirmed matches; pass back in for the next batch. */
  taken: string[];
  poolSize: number;
  landmarkPool: number;
};

export async function matchTiles(
  supabase: SupabaseClient<Database>,
  opts: {
    personaId: string;
    accountId?: string | null;
    tiles: TileInput[];
    taken?: string[];
  }
): Promise<MatchResult> {
  const { data: reqs } = await supabase
    .from("content_requests")
    .select("id, title")
    .eq("persona_id", opts.personaId);
  const titles = new Map<string, string>();
  for (const r of reqs ?? []) titles.set(r.id, r.title);

  const { data: cuts } = await supabase
    .from("content_assets")
    .select("id, request_id, phash, orb_count, overlay_text, thumbnail_path")
    .eq("stage", "edited")
    .not("phash", "is", null);

  const hashPool: Candidate[] = [];
  const textPool: TextCandidate[] = [];
  const hasLandmarks = new Set<string>();
  const thumbOf = new Map<string, string>();
  for (const c of cuts ?? []) {
    if (!c.id || !c.request_id || !titles.has(c.request_id)) continue;
    if (c.phash) hashPool.push({ id: c.id, requestId: c.request_id, hash: c.phash });
    if (c.overlay_text) {
      textPool.push({ id: c.id, requestId: c.request_id, text: c.overlay_text });
    }
    if (c.orb_count) hasLandmarks.add(c.id);
    if (c.thumbnail_path) thumbOf.set(c.id, c.thumbnail_path);
  }

  // Reels this account has already shown us. A profile grid barely changes
  // between days, so trying these first turns the common case from a search
  // into one or two comparisons.
  let familiarIds: string[] = [];
  if (opts.accountId) {
    const { data: seen } = await supabase
      .from("reel_metrics")
      .select("asset_id")
      .eq("account_id", opts.accountId)
      .eq("match_confirmed", true)
      .not("asset_id", "is", null)
      .order("captured_at", { ascending: false })
      .limit(40);
    familiarIds = Array.from(
      new Set((seen ?? []).map((r) => r.asset_id).filter(Boolean) as string[])
    );
  }

  const taken = new Set(opts.taken ?? []);
  const out: TileMatch[] = [];

  for (const t of opts.tiles) {
    const row: TileMatch = {
      position: t.position,
      assetId: null,
      requestId: null,
      title: null,
      method: null,
      score: 0,
      lead: 0,
      needsCheck: false,
      thumbPath: null,
      closest: [],
    };
    if (!t.crop) {
      out.push(row);
      continue;
    }

    const tileHash = await fingerprint(t.crop);
    const open = hashPool.filter((c) => !taken.has(c.id) && hasLandmarks.has(c.id));
    const familiar = open.filter((c) => familiarIds.includes(c.id));
    const rest = open.filter((c) => !familiarIds.includes(c.id));
    const candidates = [...familiar, ...shortlist(tileHash, rest, HASH_SHORTLIST)];

    row.closest = shortlist(tileHash, hashPool, 3).map((c) => ({
      title: titles.get(c.requestId) ?? "—",
      score: 0,
    }));

    if (candidates.length > 0) {
      const idx = await describe(t.crop, TILE_FEATURES);
      const pool = await loadLandmarks(supabase, candidates);
      if (idx && pool.length > 0) {
        const v = await identifyByLandmarks(idx, pool);
        const winner = v.kind === "match" ? v.candidate : v.best;
        if (winner) {
          row.assetId = winner.id;
          row.requestId = winner.requestId;
          row.title = titles.get(winner.requestId) ?? null;
          row.method = "landmarks";
          row.score = v.shared;
          row.lead = v.lead;
          row.thumbPath = thumbOf.get(winner.id) ?? null;
          row.needsCheck = v.kind !== "match";
          // Only a confirmed match spends the cut. A proposal that did
          // would take the reel the next tile needed, turning one uncertain
          // row into two wrong ones.
          if (v.kind === "match") taken.add(winner.id);
          out.push(row);
          continue;
        }
      }
    }

    const byText = identifyByText(t.caption, textPool.filter((c) => !taken.has(c.id)));
    if (byText) {
      row.assetId = byText.candidate.id;
      row.requestId = byText.candidate.requestId;
      row.title = titles.get(byText.candidate.requestId) ?? null;
      row.method = "text";
      row.score = byText.score;
      row.lead = 1;
      row.thumbPath = thumbOf.get(byText.candidate.id) ?? null;
      taken.add(byText.candidate.id);
    }
    out.push(row);
  }

  return {
    tiles: out,
    taken: Array.from(taken),
    poolSize: hashPool.length,
    landmarkPool: hasLandmarks.size,
  };
}

/** Only the shortlisted indexes travel; the whole set is fifteen megabytes. */
async function loadLandmarks(
  supabase: SupabaseClient<Database>,
  candidates: Candidate[]
): Promise<LandmarkCandidate[]> {
  const { data } = await supabase
    .from("content_assets")
    .select("id, request_id, orb_index, orb_count")
    .in(
      "id",
      candidates.map((c) => c.id)
    );
  const out: LandmarkCandidate[] = [];
  for (const r of data ?? []) {
    if (!r.orb_index || !r.orb_count || !r.request_id) continue;
    out.push({
      id: r.id,
      requestId: r.request_id,
      index: { count: r.orb_count, data: Buffer.from(r.orb_index, "base64") },
    });
  }
  return out;
}
