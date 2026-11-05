"use server";

import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readShootToken, type ShootTarget } from "@/lib/shoot-token";
import { linkInspoToRequest } from "@/lib/content-links";
import { announceShoot } from "@/lib/shoot-notice";
import { fetchRequestInspo } from "@/lib/inspo-video";
import { notePlain, refreshShootList } from "@/lib/shoot-list";
import { cellName, type Dimension } from "@/lib/trials";
import { accountLabel } from "@/lib/account-analytics";
import { safeStorageName, thumbnailPathFor } from "@/lib/thumbnails";

/**
 * The upload page behind a SHOOTING button. Nobody is signed in there —
 * the token in its address is the permission, for this one inspo link or
 * trial box: takes go into storage under the persona, and on send they
 * become its job, made as the model.
 */
const MAX_TAKES = 60;

type Db = ReturnType<typeof createAdminClient>;
type Take = { path: string; name: string; mime: string; size: number; thumbPath: string | null; fansly: boolean };

async function personaOf(db: Db, t: ShootTarget): Promise<string | null> {
  if (t.kind === "link") {
    const { data } = await db.from("content_links").select("persona_id").eq("id", t.id).maybeSingle();
    return data?.persona_id ?? null;
  }
  const { data } = await db.from("trial_cells").select("trials(persona_id)").eq("id", t.id).maybeSingle();
  const trial = data?.trials as { persona_id: string } | { persona_id: string }[] | null | undefined;
  return (Array.isArray(trial) ? trial[0]?.persona_id : trial?.persona_id) ?? null;
}

/** Where each take goes, with a signed address to put it and its picture. */
export async function shootUploadUrls(token: string, names: string[]) {
  const target = readShootToken(token);
  if (!target) return { error: "This link is not valid any more", items: [] };
  if (names.length === 0 || names.length > MAX_TAKES) return { error: `1 to ${MAX_TAKES} takes at a time`, items: [] };
  const db = createAdminClient();
  const personaId = await personaOf(db, target);
  if (!personaId) return { error: "This link is not valid any more", items: [] };
  const bucket = db.storage.from("content-assets");
  const items = [];
  for (const name of names) {
    const path = `personas/${personaId}/takes/${crypto.randomUUID()}_${safeStorageName(name)}`;
    const thumbPath = thumbnailPathFor(path);
    const [file, thumb] = await Promise.all([bucket.createSignedUploadUrl(path), bucket.createSignedUploadUrl(thumbPath)]);
    if (!file.data?.signedUrl) return { error: file.error?.message ?? "Storage refused the upload", items: [] };
    items.push({ path, url: file.data.signedUrl, thumbPath, thumbUrl: thumb.data?.signedUrl ?? null });
  }
  return { error: null, items };
}

/**
 * The uploaded takes become the job: for an inspo link a new one (or more
 * takes for the one it has); for a trial box its job, sent to editing.
 */
export async function shootSend(token: string, takes: Take[], opts: { nsfw?: boolean } = {}) {
  const target = readShootToken(token);
  if (!target) return { error: "This link is not valid any more", title: null };
  const db = createAdminClient();
  const personaId = await personaOf(db, target);
  if (!personaId) return { error: "This link is not valid any more", title: null };
  const folder = `personas/${personaId}/takes/`;
  if (takes.length === 0) return { error: "Add at least one take", title: null };
  if (takes.some((t) => !t.path.startsWith(folder) || (t.thumbPath && !t.thumbPath.startsWith(folder)))) {
    return { error: "Those takes do not belong here", title: null };
  }
  const { data: model } = await db
    .from("persona_members")
    .select("user_id")
    .eq("persona_id", personaId)
    .eq("role", "model")
    .limit(1)
    .maybeSingle();
  if (!model) return { error: "No model is set up for this persona", title: null };

  const res =
    target.kind === "link"
      ? await sendLink(db, target.id, personaId, model.user_id, takes, !!opts.nsfw)
      : await sendCell(db, target.id, personaId, model.user_id, takes);
  if (res.error) return res;
  await announceShoot(personaId);
  revalidatePath("/editing");
  return res;
}

async function sendLink(db: Db, linkId: string, personaId: string, userId: string, takes: Take[], nsfw: boolean) {
  const { data: link } = await db
    .from("content_links")
    .select("id, url, note, request_id, video_path")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { error: "This link is not valid any more", title: null };

  let requestId = link.request_id;
  let title: string | null = null;
  if (requestId) {
    const { data: req } = await db.from("content_requests").select("id, title").eq("id", requestId).maybeSingle();
    if (req) title = req.title;
    else requestId = null;
  }
  const isNew = !requestId;
  if (!requestId) {
    const made = await newJob(db, personaId, userId, {
      description: notePlain(link.note) || "Self-produced based on inspo",
      inspoLink: link.url,
      status: "shooted",
      nsfw,
    });
    if (made.error || !made.id) return { error: made.error ?? "Could not make the job", title: null };
    requestId = made.id;
    title = made.title;
  }

  const error = await insertTakes(db, requestId, userId, takes);
  if (error) return { error, title: null };

  if (isNew) {
    // The link turns 👍 in the requests topic and ✅ on today's list.
    await linkInspoToRequest({ personaId, requestId, inspoUrl: link.url, linkId: link.id });
    if (!link.video_path) waitUntil(fetchRequestInspo(db, requestId).catch(() => undefined));
  } else {
    await refreshShootList(db, personaId);
  }
  revalidatePath(`/requests/${requestId}`);
  return { error: null, title };
}

/** A trial box: its job (made on the first takes, like the trial page does), the takes, and off to editing. */
async function sendCell(db: Db, cellId: string, personaId: string, userId: string, takes: Take[]) {
  const { data: cell } = await db.from("trial_cells").select("*").eq("id", cellId).maybeSingle();
  if (!cell) return { error: "This box is not there any more", title: null };
  const { data: trial } = await db
    .from("trials")
    .select("id, account_id, post_url, status")
    .eq("id", cell.trial_id)
    .maybeSingle();
  if (!trial || trial.status !== "active") return { error: "This Trial-Maxxing is not running any more", title: null };

  let requestId = cell.request_id;
  if (!requestId) {
    const { data: account } = trial.account_id
      ? await db.from("accounts").select("handle, display_name").eq("id", trial.account_id).maybeSingle()
      : { data: null };
    const acc = account ? account.display_name || accountLabel(account.handle) : "the outlier's account";
    const name = cellName({ dimension: cell.dimension as Dimension, slot: cell.slot, label: cell.label });
    const made = await newJob(db, personaId, userId, {
      description: `🧪 Trial-Maxxing · ${name} · ${acc}`,
      inspoLink: trial.post_url,
      status: "requested",
    });
    if (made.error || !made.id) return { error: made.error ?? "Could not make the job", title: null };
    // The trial page may have made one meanwhile; then that one is kept.
    const { data: claimed } = await db
      .from("trial_cells")
      .update({ request_id: made.id, updated_at: new Date().toISOString() })
      .eq("id", cellId)
      .is("request_id", null)
      .select("request_id")
      .maybeSingle();
    if (claimed) requestId = made.id;
    else {
      await db.from("content_requests").delete().eq("id", made.id);
      const { data: again } = await db.from("trial_cells").select("request_id").eq("id", cellId).maybeSingle();
      requestId = again?.request_id ?? null;
    }
  }
  if (!requestId) return { error: "Could not make the job", title: null };

  const error = await insertTakes(db, requestId, userId, takes);
  if (error) return { error, title: null };

  const now = new Date().toISOString();
  const thumb = takes.find((t) => t.thumbPath)?.thumbPath ?? null;
  await db
    .from("content_requests")
    .update({ status: "shooted", shooted_at: now, updated_at: now })
    .eq("id", requestId)
    .eq("status", "requested");
  await db
    .from("trial_cells")
    .update({ finished_at: cell.finished_at ?? now, thumb_path: cell.thumb_path ?? thumb, updated_at: now })
    .eq("id", cellId);
  const { data: req } = await db.from("content_requests").select("title").eq("id", requestId).maybeSingle();
  await refreshShootList(db, personaId);
  revalidatePath(`/trials/${trial.id}`);
  revalidatePath("/trials");
  return { error: null, title: req?.title ?? null };
}

async function insertTakes(db: Db, requestId: string, userId: string, takes: Take[]): Promise<string | null> {
  const { error } = await db.from("content_assets").insert(
    takes.map((t) => ({
      request_id: requestId,
      stage: "raw",
      file_path: t.path,
      file_name: t.name.slice(0, 200),
      mime_type: t.mime,
      size_bytes: t.size,
      thumbnail_path: t.thumbPath,
      fansly: t.fansly,
      uploaded_by: userId,
    }))
  );
  return error?.message ?? null;
}

/** "Reel #N" like every other job. */
async function newJob(
  db: Db,
  personaId: string,
  userId: string,
  job: { description: string; inspoLink: string | null; status: "shooted" | "requested"; nsfw?: boolean }
) {
  const [{ data: titles }, { data: top }] = await Promise.all([
    db.from("content_requests").select("title").eq("persona_id", personaId).ilike("title", "Reel #%"),
    db
      .from("content_requests")
      .select("position")
      .eq("persona_id", personaId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  let max = 0;
  for (const r of titles ?? []) {
    const m = r.title?.match(/^Reel\s*#(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const title = `Reel #${max + 1}`;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("content_requests")
    .insert({
      persona_id: personaId,
      title,
      description: job.description,
      inspo_link: job.inspoLink,
      content_type_id: null,
      is_nsfw: !!job.nsfw,
      status: job.status,
      shooted_at: job.status === "shooted" ? now : null,
      position: (top?.position ?? 0) + 1,
      created_by: userId,
    })
    .select("id")
    .single();
  return { id: data?.id ?? null, title, error: error?.message ?? null };
}
