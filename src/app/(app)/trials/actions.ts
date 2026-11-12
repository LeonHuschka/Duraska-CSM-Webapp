"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActivePersonaId } from "@/lib/persona";
import { getNextReelTitle } from "@/app/(app)/vault/actions";
import {
  DIMENSIONS,
  MAX_RESHOOTS,
  cellName,
  decideProposal,
  decideTrial,
  ensureTrial,
  loadTrial,
  notifyTrial,
  storeOutlierVideo,
  type Dimension,
  type Phase,
} from "@/lib/trials";
import { accountLabel } from "@/lib/account-analytics";
import { refreshShootList } from "@/lib/shoot-list";

type Sb = Awaited<ReturnType<typeof createClient>>;

async function who(supabase: Sb, personaId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const staff = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  return { userId: user.id, staff, member: staff || !!membership };
}

/** Today's SHOOTING list, after a trial box or round changed. */
async function shootListOf(trialId: string) {
  const admin = createAdminClient();
  const { data: t } = await admin.from("trials").select("persona_id").eq("id", trialId).maybeSingle();
  if (t) await refreshShootList(admin, t.persona_id);
}

function touch(trialId: string) {
  revalidatePath(`/trials/${trialId}`);
  revalidatePath("/trials");
  revalidatePath("/");
}

/**
 * Start Trial-Maxxing on a reel: the trial with the outlier as it stands
 * today, its eighteen empty cells, and a word to the model in Telegram.
 * Starting it twice on the same reel opens the one that exists.
 */
export async function createTrial(input: { accountId: string; shortcode: string }) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can start Trial-Maxxing", id: null };

  // The outlier as the scrape last saw it, and what is usual on its account.
  const [{ data: rows }, { data: all }, { data: account }] = await Promise.all([
    supabase
      .from("reel_metrics")
      .select("views, post_url, caption, cover_path, request_id, captured_at")
      .eq("account_id", input.accountId)
      .eq("shortcode", input.shortcode)
      .order("captured_at", { ascending: false })
      .limit(1),
    supabase
      .from("reel_metrics")
      .select("shortcode, views, captured_at")
      .eq("account_id", input.accountId)
      .eq("source", "scrape")
      .not("views", "is", null)
      .order("captured_at", { ascending: false })
      .limit(3000),
    supabase.from("accounts").select("platform").eq("id", input.accountId).maybeSingle(),
  ]);
  const r = rows?.[0];
  if (!r) return { error: "That reel has not been read from the account yet", id: null };
  const latest = new Map<string, number>();
  for (const x of all ?? []) if (x.shortcode && !latest.has(x.shortcode)) latest.set(x.shortcode, Number(x.views));
  const vals = Array.from(latest.values()).filter((v) => v > 0).sort((a, b) => a - b);
  const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : 0;

  // The same rules as a winner: a reel goes in once; a busy account gets
  // it as a proposal, decided on its page.
  const decision = await decideTrial(supabase, {
    personaId,
    accountId: input.accountId,
    shortcode: input.shortcode,
    requestId: r.request_id,
    coverPath: r.cover_path,
    caption: r.caption,
    views: r.views,
  });
  if (decision.kind === "family") {
    return { error: `This reel is already in Trial-Maxxing (${decision.why})`, id: decision.trialId };
  }
  const res = await ensureTrial(supabase, {
    status: decision.kind === "open" ? "active" : "proposed",
    replacesTrialId: decision.kind === "open" ? null : decision.currentId,
    personaId,
    accountId: input.accountId,
    platform: account?.platform ?? "instagram",
    shortcode: input.shortcode,
    postUrl: r.post_url,
    caption: r.caption,
    coverPath: r.cover_path,
    views: r.views,
    lift: r.views && median > 0 ? Number(r.views) / median : null,
    sourceRequestId: r.request_id,
    createdBy: me.userId,
  });
  if (res.id) touch(res.id);
  return { error: res.error, id: res.id };
}

/** Fetch the outlier's video for a trial that has none yet. */
export async function fetchOutlierVideo(trialId: string) {
  const supabase = await createClient();
  const ok = await storeOutlierVideo(supabase, trialId);
  if (ok) touch(trialId);
  return { ok };
}

/**
 * The job behind a cell, made the first time a take is about to land.
 * Status "requested" while takes are still coming in: it is not work for
 * the editor until she presses finish.
 */
export async function openCellJob(cellId: string) {
  const supabase = await createClient();
  const { data: cell } = await supabase.from("trial_cells").select("*").eq("id", cellId).maybeSingle();
  if (!cell) return { error: "No such cell", requestId: null, personaId: null };
  const { data: trial } = await supabase
    .from("trials")
    .select("id, persona_id, account_id, post_url, phase")
    .eq("id", cell.trial_id)
    .maybeSingle();
  if (!trial) return { error: "No such trial", requestId: null, personaId: null };
  const me = await who(supabase, trial.persona_id);
  if (!me?.member) return { error: "Not a member of this persona", requestId: null, personaId: null };
  if (cell.request_id) return { error: null, requestId: cell.request_id, personaId: trial.persona_id };

  const { data: account } = trial.account_id
    ? await supabase.from("accounts").select("handle, display_name").eq("id", trial.account_id).maybeSingle()
    : { data: null };
  const acc = account ? account.display_name || accountLabel(account.handle) : "the outlier's account";
  const name = cellName({ dimension: cell.dimension as Dimension, slot: cell.slot, label: cell.label });
  const { title } = await getNextReelTitle();
  const { data: maxRow } = await supabase
    .from("content_requests")
    .select("position")
    .eq("persona_id", trial.persona_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: req, error } = await supabase
    .from("content_requests")
    .insert({
      persona_id: trial.persona_id,
      title,
      // Short on purpose: the trial page holds the brief, and a round has
      // as many reshoots as the team set, not what a sentence would freeze.
      description: `🧪 Trial-Maxxing · ${name} · ${acc}${cell.brief?.trim() ? `\n\n${cell.brief.trim()}` : ""}`,
      inspo_link: trial.post_url,
      status: "requested",
      position: (maxRow?.position ?? 0) + 1,
      created_by: me.userId,
    })
    .select("id")
    .single();
  if (error || !req) return { error: error?.message ?? "Could not create the job", requestId: null, personaId: null };
  // Two takes picked at once can race here; the second keeps the first job.
  const { data: claimed } = await supabase
    .from("trial_cells")
    .update({ request_id: req.id, updated_at: new Date().toISOString() })
    .eq("id", cellId)
    .is("request_id", null)
    .select("request_id")
    .maybeSingle();
  if (!claimed) {
    await supabase.from("content_requests").delete().eq("id", req.id);
    const { data: again } = await supabase.from("trial_cells").select("request_id").eq("id", cellId).maybeSingle();
    return { error: null, requestId: again?.request_id ?? null, personaId: trial.persona_id };
  }
  touch(trial.id);
  return { error: null, requestId: req.id, personaId: trial.persona_id };
}

/** One take of a cell, stored as a raw asset of its job. */
export async function recordTake(input: {
  cellId: string;
  requestId: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Shot in a Fansly outfit. */
  fansly?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", id: null, fansly: null };
  const { data: row, error } = await supabase
    .from("content_assets")
    .insert({
      request_id: input.requestId,
      stage: "raw",
      file_path: input.file_path,
      file_name: input.file_name,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      fansly: !!input.fansly,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "not saved", id: null, fansly: null };
  const { data: cell } = await supabase.from("trial_cells").select("trial_id").eq("id", input.cellId).maybeSingle();
  if (cell) touch(cell.trial_id);
  return { error: null, id: row.id, fansly: !!input.fansly };
}

/** The picture in the cell, from the first take. */
export async function setCellThumb(cellId: string, path: string) {
  const supabase = await createClient();
  const { data: cell } = await supabase
    .from("trial_cells")
    .update({ thumb_path: path, updated_at: new Date().toISOString() })
    .eq("id", cellId)
    .is("thumb_path", null)
    .select("trial_id")
    .maybeSingle();
  if (cell) touch(cell.trial_id);
  return { error: null };
}

/** All takes are in: the job goes to editing. */
export async function finishCell(cellId: string) {
  const supabase = await createClient();
  const { data: cell } = await supabase.from("trial_cells").select("trial_id, request_id").eq("id", cellId).maybeSingle();
  if (!cell?.request_id) return { error: "Upload at least one take first" };
  const { count } = await supabase
    .from("content_assets")
    .select("id", { count: "exact", head: true })
    .eq("request_id", cell.request_id)
    .eq("stage", "raw")
    .is("deleted_at", null);
  if (!count) return { error: "Upload at least one take first" };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("content_requests")
    .update({ status: "shooted", shooted_at: now, updated_at: now })
    .eq("id", cell.request_id)
    .eq("status", "requested");
  if (error) return { error: error.message };
  await supabase.from("trial_cells").update({ finished_at: now, updated_at: now }).eq("id", cellId);
  touch(cell.trial_id);
  await shootListOf(cell.trial_id);
  return { error: null };
}

/** What a cell is about: "black dress", "beach", "POV: …". Staff only. */
export async function setCellLabel(cellId: string, label: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can name cells" };
  const { data: cell } = await supabase
    .from("trial_cells")
    .update({ label: label.trim().slice(0, 60) || null, updated_at: new Date().toISOString() })
    .eq("id", cellId)
    .select("trial_id")
    .maybeSingle();
  if (cell) touch(cell.trial_id);
  return { error: null };
}

/**
 * What the model is to do in a variation, or the team's own notes on it.
 * The brief also goes into the job's description, so the editor reads it.
 */
export async function setCellText(cellId: string, field: "brief" | "notes", text: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers write here" };
  const value = text.trim().slice(0, 1000) || null;
  const { data: cell } = await supabase
    .from("trial_cells")
    .update(field === "brief" ? { brief: value, updated_at: new Date().toISOString() } : { notes: value, updated_at: new Date().toISOString() })
    .eq("id", cellId)
    .select("trial_id, request_id, dimension, slot, label")
    .maybeSingle();
  if (!cell) return { error: "No such variation" };
  if (field === "brief" && cell.request_id) {
    const { data: req } = await supabase.from("content_requests").select("description").eq("id", cell.request_id).maybeSingle();
    const head = (req?.description ?? "").split("\n\n")[0] || `🧪 Trial-Maxxing · ${cellName({ dimension: cell.dimension as Dimension, slot: cell.slot, label: cell.label })}`;
    await supabase
      .from("content_requests")
      .update({ description: value ? `${head}\n\n${value}` : head })
      .eq("id", cell.request_id);
  }
  touch(cell.trial_id);
  return { error: null };
}

export async function toggleWinner(cellId: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers pick winners" };
  const { data: cell } = await supabase.from("trial_cells").select("trial_id, winner").eq("id", cellId).maybeSingle();
  if (!cell) return { error: "No such cell" };
  await supabase.from("trial_cells").update({ winner: !cell.winner, updated_at: new Date().toISOString() }).eq("id", cellId);
  touch(cell.trial_id);
  return { error: null };
}

/** Decide the round and open the next one — with the winners the team picked. */
export async function advanceTrial(trialId: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers decide a round" };
  const t = await loadTrial(supabase, trialId);
  if (!t) return { error: "No such trial" };
  if (t.phase === "done") return { error: "This trial is finished" };
  const d = t.phase as Dimension;
  const row = t.cells.filter((c) => c.dimension === d);
  if (!row.some((c) => c.winner)) return { error: "Pick the winner of this round first" };
  const after = DIMENSIONS[DIMENSIONS.indexOf(d) + 1] as Dimension | undefined;
  const next = (after ?? "done") as Phase;
  await supabase
    .from("trials")
    .update({ phase: next, status: next === "done" ? "done" : "active", updated_at: new Date().toISOString() })
    .eq("id", trialId);
  await notifyTrial(trialId, next === "done" ? "done" : "round");
  touch(trialId);
  await shootListOf(trialId);
  return { error: null };
}

/** Replace the running trial with a proposed one, or put the proposal away. */
export async function decideTrialProposal(trialId: string, replace: boolean) {
  const supabase = await createClient();
  const { data: t } = await supabase.from("trials").select("persona_id").eq("id", trialId).maybeSingle();
  if (!t) return { error: "No such trial" };
  const me = await who(supabase, t.persona_id);
  if (!me?.staff) return { error: "Only owners and managers decide this" };
  const res = await decideProposal(supabase, trialId, replace);
  touch(trialId);
  return res;
}

export async function archiveTrial(trialId: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can stop a trial" };
  await supabase.from("trials").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", trialId);
  touch(trialId);
  await shootListOf(trialId);
  return { error: null };
}

/**
 * How many reshoots each round of a trial has. More adds empty boxes;
 * fewer takes away only boxes nothing has gone into yet. The choice is
 * also what the persona's next trials start with.
 */
export async function setTrialReshoots(trialId: string, count: number) {
  const supabase = await createClient();
  const view = await loadTrial(supabase, trialId);
  if (!view) return { error: "No such trial" };
  const me = await who(supabase, view.personaId);
  if (!me?.staff) return { error: "Only owners and managers can change this" };
  const n = Math.round(count);
  if (!Number.isFinite(n) || n < 1 || n > MAX_RESHOOTS) return { error: `Between 1 and ${MAX_RESHOOTS}` };

  const beyond = view.cells.filter((c) => c.slot > n);
  const inUse = beyond.filter((c) => c.requestId || c.winner || c.state !== "empty");
  if (inUse.length) {
    return { error: `${inUse.map((c) => cellName(c)).join(", ")} already ${inUse.length === 1 ? "has" : "have"} takes — keep at least ${Math.max(...inUse.map((c) => c.slot))}` };
  }
  if (beyond.length) {
    const { error } = await supabase.from("trial_cells").delete().in("id", beyond.map((c) => c.id));
    if (error) return { error: error.message };
  }
  const missing = DIMENSIONS.flatMap((d) =>
    Array.from({ length: n }, (_, i) => i + 1)
      .filter((slot) => !view.cells.some((c) => c.dimension === d && c.slot === slot))
      .map((slot) => ({ trial_id: trialId, dimension: d, slot }))
  );
  if (missing.length) {
    const { error } = await supabase.from("trial_cells").insert(missing);
    if (error) return { error: error.message };
  }
  await supabase.from("trials").update({ reshoots: n, updated_at: new Date().toISOString() }).eq("id", trialId);
  // Personas are written by owners only under RLS; a manager's choice is
  // checked above and saved with the service key.
  await createAdminClient().from("personas").update({ trial_reshoots: n }).eq("id", view.personaId);
  touch(trialId);
  return { error: null };
}

/** The cells of a round numbered 1, 2, 3… again, after one left it. */
async function compact(supabase: Sb, trialId: string, dimension: string) {
  const { data: rest } = await supabase
    .from("trial_cells")
    .select("id, slot")
    .eq("trial_id", trialId)
    .eq("dimension", dimension)
    .order("slot");
  // In order, each moves down into a slot already free.
  const list = rest ?? [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].slot !== i + 1) await supabase.from("trial_cells").update({ slot: i + 1 }).eq("id", list[i].id);
  }
}

async function nextSlot(supabase: Sb, trialId: string, dimension: string): Promise<number> {
  const { data } = await supabase
    .from("trial_cells")
    .select("slot")
    .eq("trial_id", trialId)
    .eq("dimension", dimension)
    .order("slot", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.slot ?? 0) + 1;
}

async function staffCell(supabase: Sb, cellId: string) {
  const { data: cell } = await supabase.from("trial_cells").select("*").eq("id", cellId).maybeSingle();
  if (!cell) return null;
  const { data: t } = await supabase.from("trials").select("persona_id").eq("id", cell.trial_id).maybeSingle();
  const me = t ? await who(supabase, t.persona_id) : null;
  return me?.staff ? cell : null;
}

/** One more variation in a round — rounds need not be the same size. */
export async function addCell(trialId: string, dimension: Dimension) {
  const supabase = await createClient();
  const { data: t } = await supabase.from("trials").select("persona_id").eq("id", trialId).maybeSingle();
  if (!t) return { error: "No such trial" };
  const me = await who(supabase, t.persona_id);
  if (!me?.staff) return { error: "Only owners and managers can change the rounds" };
  if (!DIMENSIONS.includes(dimension)) return { error: "No such round" };
  const slot = await nextSlot(supabase, trialId, dimension);
  if (slot > MAX_RESHOOTS) return { error: `A round takes ${MAX_RESHOOTS} at most` };
  const { error } = await supabase.from("trial_cells").insert({ trial_id: trialId, dimension, slot });
  if (error) return { error: error.message };
  touch(trialId);
  await shootListOf(trialId);
  return { error: null };
}

/** A variation into another round, takes and all; it is no one's winner there. */
export async function moveCell(cellId: string, dimension: Dimension) {
  const supabase = await createClient();
  const cell = await staffCell(supabase, cellId);
  if (!cell) return { error: "Not allowed" };
  if (!DIMENSIONS.includes(dimension)) return { error: "No such round" };
  if (cell.dimension === dimension) return { error: null };
  const slot = await nextSlot(supabase, cell.trial_id, dimension);
  if (slot > MAX_RESHOOTS) return { error: `A round takes ${MAX_RESHOOTS} at most` };
  const { error } = await supabase
    .from("trial_cells")
    .update({ dimension, slot, winner: false, updated_at: new Date().toISOString() })
    .eq("id", cellId);
  if (error) return { error: error.message };
  await compact(supabase, cell.trial_id, cell.dimension);
  touch(cell.trial_id);
  await shootListOf(cell.trial_id);
  return { error: null };
}

/** An empty variation out of its round. One with takes stays — move it instead. */
export async function removeCell(cellId: string) {
  const supabase = await createClient();
  const cell = await staffCell(supabase, cellId);
  if (!cell) return { error: "Not allowed" };
  if (cell.request_id || cell.winner || cell.finished_at) return { error: "It has takes — move it to another round instead" };
  const { error } = await supabase.from("trial_cells").delete().eq("id", cellId);
  if (error) return { error: error.message };
  await compact(supabase, cell.trial_id, cell.dimension);
  touch(cell.trial_id);
  await shootListOf(cell.trial_id);
  return { error: null };
}

/** How many variations a round of a new trial starts with. */
export async function setDefaultReshoots(count: number) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can change this" };
  const n = Math.round(count);
  if (!Number.isFinite(n) || n < 1 || n > MAX_RESHOOTS) return { error: `Between 1 and ${MAX_RESHOOTS}` };
  await createAdminClient().from("personas").update({ trial_reshoots: n }).eq("id", personaId);
  revalidatePath("/trials");
  return { error: null };
}

/**
 * Ask for a variation in her SHOOTING message — its brief and a button to
 * its upload — or take it out again. Three at a time per trial.
 */
export async function requestCell(cellId: string, on: boolean) {
  const supabase = await createClient();
  const cell = await staffCell(supabase, cellId);
  if (!cell) return { error: "Not allowed" };
  if (on) {
    const { data: open } = await supabase
      .from("trial_cells")
      .select("id")
      .eq("trial_id", cell.trial_id)
      .not("requested_at", "is", null)
      .is("finished_at", null)
      .neq("id", cellId);
    if ((open ?? []).length >= 3) return { error: "Three are in SHOOTING already — take one out first" };
  }
  const { error } = await supabase
    .from("trial_cells")
    .update({ requested_at: on ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", cellId);
  if (error) return { error: error.message };
  touch(cell.trial_id);
  await shootListOf(cell.trial_id);
  return { error: null };
}
