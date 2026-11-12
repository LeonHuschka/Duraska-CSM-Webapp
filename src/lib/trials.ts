import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
import { downloadVideo, resolveFacebookVideoUrl, resolveVideoUrl } from "@/lib/inspo-video";
import { accountLabel } from "@/lib/account-analytics";

/**
 * Trial-Maxxing.
 *
 * A reel that ran far above its account's usual reach is an outlier: the
 * people on that account answered this kind of content. It is reshot in
 * three rounds, one thing changed at a time — six outfits, then six
 * locations in the winning outfit, then six hooks on the winning outfit
 * and location — and each round's best performers carry into the next.
 * What is left at the end is the account's pattern.
 *
 * Every cell of the matrix becomes its own edit job the moment its first
 * take lands, in status "requested" while takes are still coming, and goes
 * to editing ("shooted") when she presses finish.
 */
type Sb = SupabaseClient<Database>;

export const APP_URL = "https://csm-duraskastudios.space";

export const DIMENSIONS = ["outfit", "location", "hook"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Phase = Dimension | "done";

export const DIM_META: Record<Dimension, { title: string; one: string; many: string; emoji: string; round: number }> = {
  outfit: { title: "Outfits", one: "Outfit", many: "outfits", emoji: "👗", round: 1 },
  location: { title: "Locations", one: "Location", many: "locations", emoji: "📍", round: 2 },
  hook: { title: "Hooks", one: "Hook", many: "hooks", emoji: "🪝", round: 3 },
};

export type CellState = "empty" | "takes" | "finished" | "edited" | "posted";

export type CellView = {
  id: string;
  dimension: Dimension;
  slot: number;
  label: string | null;
  requestId: string | null;
  title: string | null;
  takes: number;
  cuts: number;
  state: CellState;
  thumb: string | null;
  views: number | null;
  postedAt: string | null;
  winner: boolean;
  /** The first take, signed, for drawing a picture when the cell has none. */
  firstTake: { url: string; mime: string | null } | null;
  /** What she plays on the tile: the first cut, else the first take. */
  video: { url: string; cut: boolean } | null;
  /** Plays of each post of the job, per account, biggest first. */
  plays: CellPlays[];
  /** What the model is to do in this variation (the team writes it, she reads it). */
  brief: string | null;
  /** The team's own notes; left out of the page for the model. */
  notes: string | null;
  /** When the team sent it to her SHOOTING message; null when not asked for there. */
  requestedAt: string | null;
};

export type CellPlays = { accountId: string; label: string; avatar: string | null; platform: string; views: number; url: string | null };

export type TrialView = {
  id: string;
  personaId: string;
  accountId: string | null;
  account: { label: string; platform: string; avatar: string | null; median: number | null } | null;
  shortcode: string;
  postUrl: string | null;
  caption: string | null;
  /** What the team calls it for the model, e.g. "towel door". */
  nickname: string | null;
  cover: string | null;
  /** The outlier itself, playable: our cut when it is one of ours, else the copy stored at the start. */
  video: string | null;
  views: number | null;
  lift: number | null;
  sourceTitle: string | null;
  phase: Phase;
  status: string;
  createdAt: string;
  /** Reshoots per round. */
  reshoots: number;
  cells: CellView[];
};

export const phaseIndex = (p: Phase) => (p === "done" ? 3 : DIMENSIONS.indexOf(p));

/** What she is asked to do in a round, given what won before it. */
export function roundBrief(d: Dimension, winners: { outfit: string[]; location: string[] }, n = 6): string {
  const list = (xs: string[]) => xs.join(" or ");
  if (d === "outfit") return `Same location, same hook as the outlier — only the outfit changes. ${n} different outfits.`;
  if (d === "location") {
    const o = winners.outfit.length ? `Wear ${list(winners.outfit)}` : "Wear the winning outfit";
    return `${o}, same hook — only the location changes. ${n} different places.`;
  }
  const o = winners.outfit.length ? list(winners.outfit) : "the winning outfit";
  const l = winners.location.length ? list(winners.location) : "the winning location";
  return `${o} at ${l} — only the hook changes: the first second and the text on screen. ${n} different hooks.`;
}

/** Reshoots a round may have. */
export const MAX_RESHOOTS = 12;

export function cellName(c: { dimension: Dimension; slot: number; label: string | null }): string {
  return c.label?.trim() ? c.label.trim() : `${DIM_META[c.dimension].one} ${c.slot}`;
}

/** Everything the trial page draws, in one read. */
export async function loadTrial(supabase: Sb, trialId: string): Promise<TrialView | null> {
  const { data: t } = await supabase.from("trials").select("*").eq("id", trialId).maybeSingle();
  if (!t) return null;
  const [{ data: cells }, { data: account }] = await Promise.all([
    supabase.from("trial_cells").select("*").eq("trial_id", t.id).order("dimension").order("slot"),
    t.account_id
      ? supabase.from("accounts").select("id, handle, display_name, platform, avatar_path").eq("id", t.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const views = await cellsView(supabase, cells ?? [], t.account_id);

  let sourceTitle: string | null = null;
  let cutPath: string | null = null;
  if (t.source_request_id) {
    const [{ data: r }, { data: cut }] = await Promise.all([
      supabase.from("content_requests").select("title").eq("id", t.source_request_id).maybeSingle(),
      supabase
        .from("content_assets")
        .select("file_path")
        .eq("request_id", t.source_request_id)
        .eq("stage", "edited")
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    sourceTitle = r?.title ?? null;
    cutPath = cut?.file_path ?? null;
  }
  const videoPath = t.video_path ?? cutPath;
  const paths = [t.cover_path, account?.avatar_path, videoPath].filter((p): p is string => !!p);
  const signed = await sign(supabase, paths);
  const median = t.views && t.lift ? Math.round(Number(t.views) / Number(t.lift)) : null;
  return {
    id: t.id,
    personaId: t.persona_id,
    accountId: t.account_id,
    account: account
      ? {
          label: account.display_name || accountLabel(account.handle),
          platform: account.platform,
          avatar: account.avatar_path ? signed.get(account.avatar_path) ?? null : null,
          median,
        }
      : null,
    shortcode: t.shortcode,
    postUrl: t.post_url,
    caption: t.caption,
    nickname: t.nickname ?? null,
    cover: t.cover_path ? signed.get(t.cover_path) ?? null : null,
    video: videoPath ? signed.get(videoPath) ?? null : null,
    views: t.views,
    lift: t.lift == null ? null : Number(t.lift),
    sourceTitle,
    phase: t.phase as Phase,
    status: t.status,
    createdAt: t.created_at,
    reshoots: t.reshoots ?? 6,
    cells: views,
  };
}

type CellRow = Database["public"]["Tables"]["trial_cells"]["Row"];

async function sign(supabase: Sb, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await supabase.storage.from("content-assets").createSignedUrls(Array.from(new Set(paths)), 3600);
  for (const u of data ?? []) if (u.path && u.signedUrl) out.set(u.path, u.signedUrl);
  return out;
}

/** Each cell with its job's progress, its picture and what it drew once posted. */
async function cellsView(supabase: Sb, cells: CellRow[], accountId: string | null): Promise<CellView[]> {
  const ids = cells.map((c) => c.request_id).filter((x): x is string => !!x);
  const [reqs, assets, slots, reels] = ids.length
    ? await Promise.all([
        supabase.from("content_requests").select("id, title, status").in("id", ids),
        supabase
          .from("content_assets")
          .select("request_id, stage, thumbnail_path, uploaded_at, file_path, mime_type")
          .in("request_id", ids)
          .is("deleted_at", null)
          .order("uploaded_at", { ascending: true }),
        supabase.from("schedule_slots").select("request_id, status, posted_at, scheduled_for").in("request_id", ids).eq("status", "posted"),
        supabase
          .from("reel_metrics")
          .select("request_id, account_id, shortcode, post_url, views, captured_at")
          .in("request_id", ids)
          .eq("source", "scrape")
          .order("captured_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const reqById = new Map((reqs.data ?? []).map((r) => [r.id, r]));
  const takes = new Map<string, number>();
  const cuts = new Map<string, number>();
  const firstThumb = new Map<string, string>();
  const firstRaw = new Map<string, { path: string; mime: string | null }>();
  const firstCut = new Map<string, string>();
  for (const a of (assets.data ?? []) as { request_id: string; stage: string; thumbnail_path: string | null; file_path: string; mime_type: string | null }[]) {
    if (a.stage === "raw" && !firstRaw.has(a.request_id)) firstRaw.set(a.request_id, { path: a.file_path, mime: a.mime_type });
    if (a.stage === "edited" && !firstCut.has(a.request_id)) firstCut.set(a.request_id, a.file_path);
    if (a.stage === "raw") takes.set(a.request_id, (takes.get(a.request_id) ?? 0) + 1);
    else cuts.set(a.request_id, (cuts.get(a.request_id) ?? 0) + 1);
    if (a.thumbnail_path && !firstThumb.has(a.request_id)) firstThumb.set(a.request_id, a.thumbnail_path);
  }
  const postedAt = new Map<string, string>();
  for (const s of (slots.data ?? []) as { request_id: string; posted_at: string | null; scheduled_for: string | null }[]) {
    const at = s.posted_at ?? s.scheduled_for ?? "";
    if (!postedAt.has(s.request_id) || at < postedAt.get(s.request_id)!) postedAt.set(s.request_id, at);
  }
  // Views: the latest reading of each post of the job, per account. The
  // tile's headline number is the trial's own account; every account shows.
  const latest = new Set<string>();
  const viewsByReq = new Map<string, number>();
  const perAccount = new Map<string, Map<string, { views: number; url: string | null }>>();
  for (const r of (reels.data ?? []) as { request_id: string; account_id: string | null; shortcode: string | null; post_url: string | null; views: number | null }[]) {
    const k = `${r.request_id}|${r.shortcode}`;
    if (latest.has(k) || r.views == null || !r.account_id) continue;
    latest.add(k);
    if (!accountId || r.account_id === accountId) viewsByReq.set(r.request_id, (viewsByReq.get(r.request_id) ?? 0) + r.views);
    const m = perAccount.get(r.request_id) ?? new Map<string, { views: number; url: string | null }>();
    const had = m.get(r.account_id);
    m.set(r.account_id, { views: (had?.views ?? 0) + r.views, url: had?.url ?? r.post_url });
    perAccount.set(r.request_id, m);
  }
  const accIds = Array.from(new Set(Array.from(perAccount.values()).flatMap((m) => Array.from(m.keys()))));
  const { data: accRows } = accIds.length
    ? await supabase.from("accounts").select("id, handle, display_name, platform, avatar_path").in("id", accIds)
    : { data: [] as { id: string; handle: string; display_name: string | null; platform: string; avatar_path: string | null }[] };
  const accOf = new Map((accRows ?? []).map((a) => [a.id, a]));

  const thumbPaths = cells
    .map((c) => c.thumb_path ?? (c.request_id ? firstThumb.get(c.request_id) : undefined))
    .filter((p): p is string => !!p);
  // Cells with takes but no picture yet: their first take, to draw one from.
  const needPicture = cells
    .filter((c) => !c.thumb_path && c.request_id && !firstThumb.has(c.request_id) && firstRaw.has(c.request_id))
    .map((c) => firstRaw.get(c.request_id!)!.path);
  const videoPaths = cells
    .map((c) => (c.request_id ? firstCut.get(c.request_id) ?? firstRaw.get(c.request_id)?.path : undefined))
    .filter((p): p is string => !!p);
  const avatarPaths = (accRows ?? []).map((a) => a.avatar_path).filter((p): p is string => !!p);
  const signed = await sign(supabase, [...thumbPaths, ...needPicture, ...videoPaths, ...avatarPaths]);

  const videoOf = (rid: string | null) => {
    if (!rid) return null;
    const cut = firstCut.get(rid);
    if (cut && signed.has(cut)) return { url: signed.get(cut)!, cut: true };
    const raw = firstRaw.get(rid);
    return raw && signed.has(raw.path) ? { url: signed.get(raw.path)!, cut: false } : null;
  };
  return cells.map((c) => {
    const req = c.request_id ? reqById.get(c.request_id) : undefined;
    const n = c.request_id ? takes.get(c.request_id) ?? 0 : 0;
    const posted = !!(c.request_id && (postedAt.has(c.request_id) || req?.status === "posted"));
    const state: CellState = !c.request_id || (n === 0 && !c.finished_at)
      ? "empty"
      : posted
        ? "posted"
        : req?.status === "edited" || req?.status === "scheduled"
          ? "edited"
          : c.finished_at
            ? "finished"
            : "takes";
    const thumbPath = c.thumb_path ?? (c.request_id ? firstThumb.get(c.request_id) : undefined);
    return {
      id: c.id,
      dimension: c.dimension as Dimension,
      slot: c.slot,
      label: c.label,
      requestId: c.request_id,
      title: req?.title ?? null,
      takes: n,
      cuts: c.request_id ? cuts.get(c.request_id) ?? 0 : 0,
      state,
      thumb: thumbPath ? signed.get(thumbPath) ?? null : null,
      views: c.request_id ? viewsByReq.get(c.request_id) ?? null : null,
      postedAt: c.request_id ? postedAt.get(c.request_id) ?? null : null,
      winner: c.winner,
      firstTake:
        !thumbPath && c.request_id && firstRaw.has(c.request_id) && signed.has(firstRaw.get(c.request_id)!.path)
          ? { url: signed.get(firstRaw.get(c.request_id)!.path)!, mime: firstRaw.get(c.request_id)!.mime }
          : null,
      video: videoOf(c.request_id),
      plays: Array.from((c.request_id ? perAccount.get(c.request_id) : undefined)?.entries() ?? [])
        .map(([id, v]) => {
          const a = accOf.get(id);
          return {
            accountId: id,
            label: a ? a.display_name || accountLabel(a.handle) : "account gone",
            avatar: a?.avatar_path ? signed.get(a.avatar_path) ?? null : null,
            platform: a?.platform ?? "instagram",
            views: v.views,
            url: v.url,
          };
        })
        .sort((a, b) => b.views - a.views),
      brief: c.brief ?? null,
      notes: c.notes ?? null,
      requestedAt: c.requested_at ?? null,
    };
  });
}

export type TrialSummary = {
  id: string;
  accountLabel: string;
  platform: string;
  avatar: string | null;
  cover: string | null;
  views: number | null;
  lift: number | null;
  phase: Phase;
  /** In the current round: shot (finished or further), posted, still to shoot. */
  shot: number;
  posted: number;
  started: number;
  toShoot: number;
  /** Reshoots in the current round. */
  total: number;
  brief: string;
  createdAt: string;
  /** Every round as it stands: what is shot, posted, asked for in SHOOTING. */
  rounds: RoundSummary[];
};

export type RoundSummary = {
  dimension: Dimension;
  emoji: string;
  title: string;
  cells: { state: CellState; winner: boolean; requested: boolean }[];
};

/** The active trials of a persona, as cards for the dashboards. */
export async function listTrials(supabase: Sb, personaId: string, includeDone = false): Promise<TrialSummary[]> {
  let q = supabase.from("trials").select("id").eq("persona_id", personaId).order("created_at", { ascending: false });
  if (!includeDone) q = q.eq("status", "active");
  const { data: rows } = await q.limit(30);
  const out: TrialSummary[] = [];
  for (const r of rows ?? []) {
    const t = await loadTrial(supabase, r.id);
    if (!t) continue;
    const dim: Dimension = t.phase === "done" ? "hook" : t.phase;
    const row = t.cells.filter((c) => c.dimension === dim);
    const winners = winnersOf(t);
    out.push({
      id: t.id,
      accountLabel: t.account?.label ?? "account gone",
      platform: t.account?.platform ?? "instagram",
      avatar: t.account?.avatar ?? null,
      cover: t.cover,
      views: t.views,
      lift: t.lift,
      phase: t.phase,
      shot: row.filter((c) => c.state === "finished" || c.state === "edited" || c.state === "posted").length,
      posted: row.filter((c) => c.state === "posted").length,
      started: row.filter((c) => c.state === "takes").length,
      toShoot: row.filter((c) => c.state === "empty" || c.state === "takes").length,
      total: row.length,
      brief: t.phase === "done" ? "Pattern found" : roundBrief(dim, winners, row.length),
      createdAt: t.createdAt,
      rounds: DIMENSIONS.map((d) => ({
        dimension: d,
        emoji: DIM_META[d].emoji,
        title: DIM_META[d].title,
        cells: t.cells
          .filter((c) => c.dimension === d)
          .sort((a, b) => a.slot - b.slot)
          .map((c) => ({ state: c.state, winner: c.winner, requested: !!c.requestedAt && (c.state === "empty" || c.state === "takes") })),
      })),
    });
  }
  return out;
}

/** The names of the cells marked winner in the decided rounds. */
export function winnersOf(t: Pick<TrialView, "cells">): { outfit: string[]; location: string[]; hook: string[] } {
  const pick = (d: Dimension) => t.cells.filter((c) => c.dimension === d && c.winner).map(cellName);
  return { outfit: pick("outfit"), location: pick("location"), hook: pick("hook") };
}

/**
 * The trial of a reel, made if there is none: the outlier as it stands,
 * its eighteen empty cells, and — when it is not a reel we hold a cut of —
 * a copy of its video, so the matrix can play it. Used by the winner
 * announcement, which opens a trial for every winner, and by the button on
 * the accounts tab.
 */
export async function ensureTrial(
  supabase: Sb,
  input: {
    personaId: string;
    accountId: string;
    platform: string;
    shortcode: string;
    postUrl: string | null;
    caption: string | null;
    coverPath: string | null;
    views: number | null;
    lift: number | null;
    sourceRequestId: string | null;
    createdBy?: string | null;
    /** The video, when the caller already downloaded it. */
    videoBytes?: Uint8Array | null;
    /** "proposed" waits for the team to decide whether it replaces the running trial. */
    status?: "active" | "proposed";
    replacesTrialId?: string | null;
  }
): Promise<{ id: string | null; created: boolean; error: string | null }> {
  const { data: existing } = await supabase
    .from("trials")
    .select("id")
    .eq("account_id", input.accountId)
    .eq("shortcode", input.shortcode)
    .maybeSingle();
  if (existing) return { id: existing.id, created: false, error: null };

  // As many reshoots a round as the persona last chose.
  const { data: persona } = await supabase.from("personas").select("trial_reshoots").eq("id", input.personaId).maybeSingle();
  const reshoots = Math.min(MAX_RESHOOTS, Math.max(1, persona?.trial_reshoots ?? 6));

  const { data: trial, error } = await supabase
    .from("trials")
    .insert({
      reshoots,
      persona_id: input.personaId,
      account_id: input.accountId,
      shortcode: input.shortcode,
      post_url: input.postUrl,
      caption: input.caption,
      cover_path: input.coverPath,
      views: input.views,
      lift: input.lift == null ? null : Math.round(input.lift * 10) / 10,
      source_request_id: input.sourceRequestId,
      created_by: input.createdBy ?? null,
      status: input.status ?? "active",
      replaces_trial_id: input.replacesTrialId ?? null,
    })
    .select("id")
    .single();
  if (error || !trial) return { id: null, created: false, error: error?.message ?? "could not start" };
  const cells = DIMENSIONS.flatMap((d) =>
    Array.from({ length: reshoots }, (_, i) => ({ trial_id: trial.id, dimension: d, slot: i + 1 }))
  );
  const { error: cellErr } = await supabase.from("trial_cells").insert(cells);
  if (cellErr) return { id: trial.id, created: true, error: cellErr.message };
  await storeOutlierVideo(supabase, trial.id, { bytes: input.videoBytes ?? null, platform: input.platform });
  return { id: trial.id, created: true, error: null };
}

/**
 * Put the outlier's video in storage. Not needed when it is a reel of
 * ours — the cut plays — and fetched from the platform otherwise, which
 * costs a fraction of a cent through the same resolvers the bot uses.
 */
export async function storeOutlierVideo(
  supabase: Sb,
  trialId: string,
  opts: { bytes?: Uint8Array | null; platform?: string } = {}
): Promise<boolean> {
  const { data: t } = await supabase.from("trials").select("id, persona_id, account_id, post_url, video_path, source_request_id").eq("id", trialId).maybeSingle();
  if (!t || t.video_path) return !!t?.video_path;
  if (t.source_request_id) {
    const { count } = await supabase
      .from("content_assets")
      .select("id", { count: "exact", head: true })
      .eq("request_id", t.source_request_id)
      .eq("stage", "edited")
      .is("deleted_at", null);
    if (count) return true;
  }
  let bytes = opts.bytes ?? null;
  if (!bytes && t.post_url) {
    let platform = opts.platform;
    if (!platform && t.account_id) {
      const { data: a } = await supabase.from("accounts").select("platform").eq("id", t.account_id).maybeSingle();
      platform = a?.platform;
    }
    const resolved = platform === "facebook" ? await resolveFacebookVideoUrl(t.post_url) : await resolveVideoUrl(t.post_url);
    bytes = resolved.ok ? await downloadVideo(resolved.url) : null;
  }
  if (!bytes) return false;
  const path = `personas/${t.persona_id}/trials/${t.id}/outlier.mp4`;
  const { error } = await supabase.storage.from("content-assets").upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) return false;
  await supabase.from("trials").update({ video_path: path }).eq("id", t.id);
  return true;
}

/** Where the trial's messages go, and who they speak to. */
async function telegramTarget(admin: Sb, personaId: string) {
  const { data: cfg } = await admin
    .from("telegram_config")
    .select("chat_id, winners_thread_id, talk_thread_id, model_username")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!cfg?.chat_id) return null;
  return {
    chat: cfg.chat_id,
    thread: cfg.winners_thread_id ?? cfg.talk_thread_id ?? null,
    model: cfg.model_username ? `@${cfg.model_username.replace(/^@/, "")}` : "",
  };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A round decided: one short line in the winners topic, under the winner
 * post of the reel, in the same voice as the winner post itself.
 */
export async function notifyTrial(trialId: string, kind: "round" | "done") {
  try {
    const admin = createAdminClient();
    const { data: t } = await admin.from("trials").select("*").eq("id", trialId).maybeSingle();
    if (!t) return;
    const target = await telegramTarget(admin, t.persona_id);
    if (!target) return;
    const view = await loadTrial(admin, trialId);
    if (!view) return;
    const { data: winner } = await admin
      .from("winners")
      .select("message_id")
      .eq("persona_id", t.persona_id)
      .eq("shortcode", t.shortcode)
      .not("message_id", "is", null)
      .limit(1)
      .maybeSingle();
    const w = winnersOf(view);
    const acc = view.account ? `${view.account.label} (${view.account.platform === "facebook" ? "Facebook" : "IG"})` : "the account";
    const lines =
      kind === "done"
        ? [
            `🏁 <b>Pattern found on ${esc(acc)}</b>`,
            `${esc(w.outfit.join(", ") || "—")} · ${esc(w.location.join(", ") || "—")} · ${esc(w.hook.join(", ") || "—")}`,
            ``,
            `${target.model ? `${target.model}, ` : ""}this is what works here — more of exactly this 💃🏻`,
          ]
        : (() => {
            const d = view.phase as Dimension;
            const prev = DIMENSIONS[DIMENSIONS.indexOf(d) - 1];
            const won = prev ? w[prev] : [];
            return [
              `🏆 <b>${DIM_META[prev ?? "outfit"].title} decided on ${esc(acc)}</b>${won.length ? ` · ${esc(won.join(", "))}` : ""}`,
              ``,
              `${target.model ? `${target.model}, ` : ""}next up: ${view.cells.filter((c) => c.dimension === d).length} ${DIM_META[d].many} — ${esc(roundBrief(d, w, view.cells.filter((c) => c.dimension === d).length))}`,
            ];
          })();
    const res = await sendMessage({
      chat_id: target.chat,
      message_thread_id: target.thread,
      text: lines.join("\n"),
      reply_to_message_id: winner?.message_id ?? null,
      buttons: [{ text: "Direct Link Reshoot", url: `${APP_URL}/trials/${trialId}` }],
    });
    if (!res.ok) console.warn("[trials] telegram:", res.error);
  } catch (err) {
    console.warn("[trials] notify failed", err);
  }
}

/* ─── One reel, one trial; one trial per account ─────────────────────────────
 *
 * A reel goes into Trial-Maxxing once, ever: not again when it goes viral on
 * a second account, and not when one of its reshoots goes viral. An account
 * runs one trial at a time. A later winner that is clearly bigger than the
 * running trial is proposed in its place, and the team decides in Telegram.
 */

/** How much bigger a new winner must be before it is offered in place of the running trial. */
export const REPLACE_FACTOR = 1.5;

export type TrialDecision =
  /** The reel is already in (or was): same post, same job, one of its reshoots, or the same video elsewhere. */
  | { kind: "family"; trialId: string; why: string }
  /** The account has no trial running. */
  | { kind: "open" }
  /** The account runs a trial, and this one is clearly bigger. */
  | { kind: "propose"; currentId: string; currentViews: number }
  /** The account runs a trial at least as big. */
  | { kind: "busy"; currentId: string; currentViews: number };

export async function decideTrial(
  supabase: Sb,
  input: {
    personaId: string;
    accountId: string;
    shortcode: string;
    requestId: string | null;
    coverPath: string | null;
    caption: string | null;
    views: number | null;
  }
): Promise<TrialDecision> {
  const { data: trials } = await supabase
    .from("trials")
    .select("id, account_id, shortcode, source_request_id, cover_path, caption, status, views, created_at")
    .eq("persona_id", input.personaId)
    .order("created_at", { ascending: false });
  const all = trials ?? [];

  const same = all.find((t) => t.shortcode === input.shortcode);
  if (same) return { kind: "family", trialId: same.id, why: "same post" };
  if (input.requestId) {
    const src = all.find((t) => t.source_request_id === input.requestId);
    if (src) return { kind: "family", trialId: src.id, why: "same job" };
    const { data: cell } = await supabase
      .from("trial_cells")
      .select("trial_id")
      .eq("request_id", input.requestId)
      .limit(1)
      .maybeSingle();
    if (cell) return { kind: "family", trialId: cell.trial_id, why: "a reshoot of it" };
  }
  const look = await sameReelByCover(supabase, input, all);
  if (look) return { kind: "family", trialId: look, why: "same video" };

  // One trial per account. A pending proposal counts as running: a third
  // winner has to beat that one too.
  const running = all.filter((t) => t.account_id === input.accountId && (t.status === "active" || t.status === "proposed"));
  if (running.length === 0) return { kind: "open" };
  let biggest = { id: running[0].id, views: 0 };
  for (const t of running) {
    const v = await latestViews(supabase, input.accountId, t.shortcode, t.views);
    if (v >= biggest.views) biggest = { id: t.id, views: v };
  }
  const current = running.find((t) => t.status === "active") ?? running[0];
  const currentViews = current.id === biggest.id ? biggest.views : await latestViews(supabase, input.accountId, current.shortcode, current.views);
  if (Number(input.views ?? 0) >= REPLACE_FACTOR * biggest.views) {
    return { kind: "propose", currentId: current.id, currentViews };
  }
  return { kind: "busy", currentId: current.id, currentViews };
}

async function latestViews(supabase: Sb, accountId: string, shortcode: string, fallback: number | null): Promise<number> {
  const { data } = await supabase
    .from("reel_metrics")
    .select("views")
    .eq("account_id", accountId)
    .eq("shortcode", shortcode)
    .eq("source", "scrape")
    .not("views", "is", null)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.views ?? fallback ?? 0);
}

/**
 * The same reel posted on another account carries another shortcode, no
 * job and often another cover frame and caption — a picture hash of the
 * covers called the tongue reel on two accounts as different as two
 * unrelated reels. So Claude looks at the covers and says which, if any,
 * shows the same reel or a reshoot of it.
 */
async function sameReelByCover(
  supabase: Sb,
  input: { coverPath: string | null; caption: string | null },
  trials: { id: string; cover_path: string | null; caption: string | null }[]
): Promise<string | null> {
  const pool = trials.filter((t) => t.cover_path).slice(0, 12);
  if (!input.coverPath || pool.length === 0 || !process.env.ANTHROPIC_API_KEY) return null;
  const image = async (path: string) => {
    const { data } = await supabase.storage.from("content-assets").download(path);
    if (!data) return null;
    const small = await sharp(Buffer.from(await data.arrayBuffer())).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer().catch(() => null);
    return small ? small.toString("base64") : null;
  };
  const fresh = await image(input.coverPath);
  if (!fresh) return null;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const labels = new Map<string, string>();
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    const b64 = await image(t.cover_path!);
    if (!b64) continue;
    const label = `T${i + 1}`;
    labels.set(label, t.id);
    content.push({ type: "text", text: `${label} — caption: ${t.caption?.slice(0, 200) ?? "(none)"}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  }
  if (labels.size === 0) return null;
  content.push({ type: "text", text: `NEW — caption: ${input.caption?.slice(0, 200) ?? "(none)"}` });
  content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fresh } });
  content.push({
    type: "text",
    text: "Is NEW the same reel as one of the T reels, or a reshoot of one? Answer with that label, or null.",
  });
  try {
    const res = await new Anthropic().beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(SameReel) },
      system: SAME_REEL_SYSTEM,
      messages: [{ role: "user", content }],
    });
    const label = res.parsed_output?.match ?? null;
    return label ? labels.get(label) ?? null : null;
  } catch (err) {
    console.warn("[trials] same-reel check failed", err);
    return null;
  }
}

const SameReel = z.object({
  match: z.string().nullable().describe("The label (T1, T2, …) of the reel NEW is the same as, or null"),
  reason: z.string().describe("One short sentence"),
});

const SAME_REEL_SYSTEM = `Each image is the cover of a short vertical reel by the same creator, posted on one of several accounts she runs.
The same video is often posted on more than one account: then the cover can be a different frame of it, cropped differently, with a different caption.
She also reshoots a reel that did well: the same idea — same action, same framing, same joke or hook — with one thing changed, such as the outfit, the place or the opening line.
Say NEW matches a T reel when it is the same video or such a reshoot of it: the same room seen from the same spot, the same pose or action, the same set-up.
Do not match two different ideas just because they were filmed by the same woman, in the same room or in the same outfit. When unsure, answer null.`;

/** Where the trial's Telegram messages go: the winners topic, under the reel's winner post. */
async function winnerMessage(admin: Sb, personaId: string, shortcode: string): Promise<number | null> {
  const { data } = await admin
    .from("winners")
    .select("message_id")
    .eq("persona_id", personaId)
    .eq("shortcode", shortcode)
    .not("message_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.message_id ?? null;
}

/**
 * A bigger winner on a busy account: an update under the running trial's
 * winner post, with the choice as two buttons into the app.
 */
export async function notifyProposal(proposedId: string) {
  try {
    const admin = createAdminClient();
    const { data: t } = await admin.from("trials").select("*").eq("id", proposedId).maybeSingle();
    if (!t?.replaces_trial_id) return;
    const { data: old } = await admin.from("trials").select("*").eq("id", t.replaces_trial_id).maybeSingle();
    if (!old) return;
    const target = await telegramTarget(admin, t.persona_id);
    if (!target) return;
    const { data: account } = await admin.from("accounts").select("handle, platform").eq("id", t.account_id ?? "").maybeSingle();
    const acc = account ? `${accountLabel(account.handle)} (${account.platform === "facebook" ? "Facebook" : "IG"})` : "the account";
    const nf = new Intl.NumberFormat("de-DE");
    const oldViews = await latestViews(admin, old.account_id ?? "", old.shortcode, old.views);
    const lines = [
      `⚡️ <b>Bigger winner on ${esc(acc)}</b>`,
      `${nf.format(Number(t.views ?? 0))} plays — the running Trial-Maxxing has ${nf.format(oldViews)}.`,
      ``,
      `Should the new one take over? What is already shot of the old one stays in editing and the vault and gets posted as normal.`,
    ];
    if (t.post_url) lines.push(`🔗 New: ${esc(t.post_url)}`);
    const res = await sendMessage({
      chat_id: target.chat,
      message_thread_id: target.thread,
      text: lines.join("\n"),
      reply_to_message_id: await winnerMessage(admin, old.persona_id, old.shortcode),
      buttons: [
        { text: "✅ Replace", url: `${APP_URL}/trials/${t.id}?decide=replace` },
        { text: "✋ Keep current", url: `${APP_URL}/trials/${t.id}?decide=keep` },
      ],
    });
    if (!res.ok) console.warn("[trials] proposal telegram:", res.error);
  } catch (err) {
    console.warn("[trials] proposal notify failed", err);
  }
}

/**
 * The team's answer to a proposal. Replace: the old trial stops, its
 * started boxes go to editing as they are — their takes become ordinary
 * reels for the account — and the new one runs. Keep: the proposal is put
 * away and the reel never comes back.
 */
export async function decideProposal(supabase: Sb, proposedId: string, replace: boolean): Promise<{ error: string | null }> {
  const { data: t } = await supabase.from("trials").select("*").eq("id", proposedId).maybeSingle();
  if (!t) return { error: "No such trial" };
  if (t.status !== "proposed") return { error: "Already decided" };
  const now = new Date().toISOString();
  if (!replace) {
    await supabase.from("trials").update({ status: "dismissed", status_note: "Kept the running trial", updated_at: now }).eq("id", t.id);
    return { error: null };
  }
  if (t.replaces_trial_id) {
    const { data: old } = await supabase.from("trials").select("id, status").eq("id", t.replaces_trial_id).maybeSingle();
    if (old && old.status === "active") {
      await supabase
        .from("trials")
        .update({ status: "replaced", status_note: `Replaced by a bigger winner (${t.shortcode})`, updated_at: now })
        .eq("id", old.id);
      // Boxes with takes in them are finished as they stand and go to editing.
      const { data: started } = await supabase
        .from("trial_cells")
        .select("id, request_id")
        .eq("trial_id", old.id)
        .is("finished_at", null)
        .not("request_id", "is", null);
      const ids = (started ?? []).map((c) => c.request_id!);
      if (ids.length) {
        const { data: withTakes } = await supabase
          .from("content_assets")
          .select("request_id")
          .in("request_id", ids)
          .eq("stage", "raw")
          .is("deleted_at", null);
        const shot = Array.from(new Set((withTakes ?? []).map((a) => a.request_id)));
        if (shot.length) {
          await supabase.from("trial_cells").update({ finished_at: now }).eq("trial_id", old.id).in("request_id", shot);
          await supabase.from("content_requests").update({ status: "shooted", shooted_at: now }).in("id", shot).eq("status", "requested");
        }
      }
    }
  }
  // Any other proposal for the account is moot now.
  if (t.account_id) {
    await supabase
      .from("trials")
      .update({ status: "dismissed", status_note: "Another winner took the account", updated_at: now })
      .eq("account_id", t.account_id)
      .eq("status", "proposed")
      .neq("id", t.id);
  }
  await supabase.from("trials").update({ status: "active", updated_at: now }).eq("id", t.id);
  await notifySwitch(t.id);
  return { error: null };
}

/** The switch, said once under the new trial's winner post. */
async function notifySwitch(trialId: string) {
  try {
    const admin = createAdminClient();
    const { data: t } = await admin.from("trials").select("*").eq("id", trialId).maybeSingle();
    if (!t) return;
    const target = await telegramTarget(admin, t.persona_id);
    if (!target) return;
    const res = await sendMessage({
      chat_id: target.chat,
      message_thread_id: target.thread,
      text: [
        `🔁 <b>Trial-Maxxing switched to this reel</b>`,
        ``,
        `${target.model ? `${target.model}, ` : ""}reshoot this one now — ${t.reshoots} ${DIM_META.outfit.many} first. What you already shot of the old one goes out as normal reels.`,
      ].join("\n"),
      reply_to_message_id: await winnerMessage(admin, t.persona_id, t.shortcode),
      buttons: [{ text: "Direct Link Reshoot", url: `${APP_URL}/trials/${t.id}` }],
    });
    if (!res.ok) console.warn("[trials] switch telegram:", res.error);
  } catch (err) {
    console.warn("[trials] switch notify failed", err);
  }
}
