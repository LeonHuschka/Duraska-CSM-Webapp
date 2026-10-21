import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
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
};

export type TrialView = {
  id: string;
  personaId: string;
  accountId: string | null;
  account: { label: string; platform: string; avatar: string | null; median: number | null } | null;
  shortcode: string;
  postUrl: string | null;
  caption: string | null;
  cover: string | null;
  views: number | null;
  lift: number | null;
  sourceTitle: string | null;
  phase: Phase;
  status: string;
  createdAt: string;
  cells: CellView[];
};

export const phaseIndex = (p: Phase) => (p === "done" ? 3 : DIMENSIONS.indexOf(p));
/** A row can be worked on once the rounds before it are decided. */
export const rowOpen = (phase: Phase, d: Dimension) => DIMENSIONS.indexOf(d) <= phaseIndex(phase);

/** What she is asked to do in a round, given what won before it. */
export function roundBrief(d: Dimension, winners: { outfit: string[]; location: string[] }): string {
  const list = (xs: string[]) => xs.join(" or ");
  if (d === "outfit") return "Same location, same hook as the outlier — only the outfit changes. Six different outfits.";
  if (d === "location") {
    const o = winners.outfit.length ? `Wear ${list(winners.outfit)}` : "Wear the winning outfit";
    return `${o}, same hook — only the location changes. Six different places.`;
  }
  const o = winners.outfit.length ? list(winners.outfit) : "the winning outfit";
  const l = winners.location.length ? list(winners.location) : "the winning location";
  return `${o} at ${l} — only the hook changes: the first second and the text on screen. Six different hooks.`;
}

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

  const paths = [t.cover_path, account?.avatar_path].filter((p): p is string => !!p);
  const signed = await sign(supabase, paths);
  let sourceTitle: string | null = null;
  if (t.source_request_id) {
    const { data: r } = await supabase.from("content_requests").select("title").eq("id", t.source_request_id).maybeSingle();
    sourceTitle = r?.title ?? null;
  }
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
    cover: t.cover_path ? signed.get(t.cover_path) ?? null : null,
    views: t.views,
    lift: t.lift == null ? null : Number(t.lift),
    sourceTitle,
    phase: t.phase as Phase,
    status: t.status,
    createdAt: t.created_at,
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
        supabase.from("content_assets").select("request_id, stage, thumbnail_path, uploaded_at").in("request_id", ids).is("deleted_at", null),
        supabase.from("schedule_slots").select("request_id, status, posted_at, scheduled_for").in("request_id", ids).eq("status", "posted"),
        supabase
          .from("reel_metrics")
          .select("request_id, account_id, shortcode, views, captured_at")
          .in("request_id", ids)
          .eq("source", "scrape")
          .order("captured_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const reqById = new Map((reqs.data ?? []).map((r) => [r.id, r]));
  const takes = new Map<string, number>();
  const cuts = new Map<string, number>();
  const firstThumb = new Map<string, string>();
  for (const a of (assets.data ?? []) as { request_id: string; stage: string; thumbnail_path: string | null }[]) {
    if (a.stage === "raw") takes.set(a.request_id, (takes.get(a.request_id) ?? 0) + 1);
    else cuts.set(a.request_id, (cuts.get(a.request_id) ?? 0) + 1);
    if (a.thumbnail_path && !firstThumb.has(a.request_id)) firstThumb.set(a.request_id, a.thumbnail_path);
  }
  const postedAt = new Map<string, string>();
  for (const s of (slots.data ?? []) as { request_id: string; posted_at: string | null; scheduled_for: string | null }[]) {
    const at = s.posted_at ?? s.scheduled_for ?? "";
    if (!postedAt.has(s.request_id) || at < postedAt.get(s.request_id)!) postedAt.set(s.request_id, at);
  }
  // Views: the latest reading of each post of the job on the trial's account, summed.
  const latest = new Map<string, number>();
  const viewsByReq = new Map<string, number>();
  for (const r of (reels.data ?? []) as { request_id: string; account_id: string | null; shortcode: string | null; views: number | null }[]) {
    if (accountId && r.account_id !== accountId) continue;
    const k = `${r.request_id}|${r.shortcode}`;
    if (latest.has(k) || r.views == null) continue;
    latest.set(k, r.views);
    viewsByReq.set(r.request_id, (viewsByReq.get(r.request_id) ?? 0) + r.views);
  }

  const thumbPaths = cells
    .map((c) => c.thumb_path ?? (c.request_id ? firstThumb.get(c.request_id) : undefined))
    .filter((p): p is string => !!p);
  const signed = await sign(supabase, thumbPaths);

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
          : c.finished_at || req?.status === "shooted"
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
  brief: string;
  createdAt: string;
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
      brief: t.phase === "done" ? "Pattern found" : roundBrief(dim, winners),
      createdAt: t.createdAt,
    });
  }
  return out;
}

/** The names of the cells marked winner in the decided rounds. */
export function winnersOf(t: Pick<TrialView, "cells">): { outfit: string[]; location: string[]; hook: string[] } {
  const pick = (d: Dimension) => t.cells.filter((c) => c.dimension === d && c.winner).map(cellName);
  return { outfit: pick("outfit"), location: pick("location"), hook: pick("hook") };
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
 * Tell the model in the winners topic. The first message answers the
 * winner post of the same reel, so it sits right under the video she was
 * asked to reshoot; every later one answers the first.
 */
export async function notifyTrial(trialId: string, kind: "started" | "round" | "done") {
  try {
    const admin = createAdminClient();
    const { data: t } = await admin.from("trials").select("*").eq("id", trialId).maybeSingle();
    if (!t) return;
    const target = await telegramTarget(admin, t.persona_id);
    if (!target) return;
    const view = await loadTrial(admin, trialId);
    if (!view) return;
    const acc = view.account ? `${view.account.platform === "facebook" ? "Facebook" : "IG"} ${view.account.label}` : "the account";
    const link = `${APP_URL}/trials/${trialId}`;
    const w = winnersOf(view);
    let text = "";
    let replyTo: number | null = t.message_id ?? null;

    if (kind === "started") {
      const { data: winner } = await admin
        .from("winners")
        .select("message_id")
        .eq("persona_id", t.persona_id)
        .eq("shortcode", t.shortcode)
        .not("message_id", "is", null)
        .limit(1)
        .maybeSingle();
      replyTo = winner?.message_id ?? null;
      text = [
        `🧪 <b>Trial-Maxxing started</b> · ${esc(acc)}`,
        `This reel is our outlier — now we find out <i>why</i> it hit.`,
        ``,
        `${target.model ? `${target.model} ` : ""}<b>Round 1 of 3 · ${DIM_META.outfit.emoji} 6 outfits</b>`,
        roundBrief("outfit", w),
        ``,
        `Each outfit gets its own box — tap it, drop the takes, press finish.`,
      ].join("\n");
    } else if (kind === "round") {
      const d = view.phase as Dimension;
      const prev = DIMENSIONS[DIMENSIONS.indexOf(d) - 1];
      const won = prev ? w[prev] : [];
      text = [
        `🧪 <b>Round ${DIM_META[d].round} of 3 · ${DIM_META[d].emoji} 6 ${DIM_META[d].many}</b> · ${esc(acc)}`,
        won.length ? `🏆 ${DIM_META[prev!].title} won: <b>${esc(won.join(", "))}</b>` : "",
        ``,
        `${target.model ? `${target.model} ` : ""}${esc(roundBrief(d, w))}`,
      ]
        .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
        .join("\n");
    } else {
      text = [
        `🏁 <b>Pattern found</b> · ${esc(acc)}`,
        `${DIM_META.outfit.emoji} ${esc(w.outfit.join(", ") || "—")}`,
        `${DIM_META.location.emoji} ${esc(w.location.join(", ") || "—")}`,
        `${DIM_META.hook.emoji} ${esc(w.hook.join(", ") || "—")}`,
        ``,
        `This is what works on this account. More of exactly this 💃🏻`,
      ].join("\n");
    }

    const res = await sendMessage({
      chat_id: target.chat,
      message_thread_id: target.thread,
      text,
      reply_to_message_id: replyTo,
      buttons: [{ text: kind === "done" ? "See the pattern" : "Open the matrix", url: link }],
    });
    if (res.ok && kind === "started" && res.result?.message_id) {
      await admin.from("trials").update({ message_id: res.result.message_id }).eq("id", trialId);
    }
    if (!res.ok) console.warn("[trials] telegram:", res.error);
  } catch (err) {
    console.warn("[trials] notify failed", err);
  }
}
