"use server";

import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readShootToken } from "@/lib/shoot-token";
import { linkInspoToRequest } from "@/lib/content-links";
import { announceShoot } from "@/lib/shoot-notice";
import { fetchRequestInspo } from "@/lib/inspo-video";
import { notePlain, refreshShootList } from "@/lib/shoot-list";
import { safeStorageName, thumbnailPathFor } from "@/lib/thumbnails";

/**
 * The upload page behind a SHOOTING button. Nobody is signed in there —
 * the token in its address is the permission, for this one inspo link:
 * takes go into storage under the persona, and on send they become the
 * link's job, made as the model.
 */
const MAX_TAKES = 60;

async function linkOf(token: string) {
  const linkId = readShootToken(token);
  if (!linkId) return null;
  const db = createAdminClient();
  const { data: link } = await db
    .from("content_links")
    .select("id, persona_id, url, note, status, request_id, video_path")
    .eq("id", linkId)
    .maybeSingle();
  return link ? { db, link } : null;
}

/** Where each take goes, with a signed address to put it and its picture. */
export async function shootUploadUrls(token: string, names: string[]) {
  const found = await linkOf(token);
  if (!found) return { error: "This link is not valid any more", items: [] };
  if (names.length === 0 || names.length > MAX_TAKES) return { error: `1 to ${MAX_TAKES} takes at a time`, items: [] };
  const { db, link } = found;
  const bucket = db.storage.from("content-assets");
  const items = [];
  for (const name of names) {
    const path = `personas/${link.persona_id}/takes/${crypto.randomUUID()}_${safeStorageName(name)}`;
    const thumbPath = thumbnailPathFor(path);
    const [file, thumb] = await Promise.all([bucket.createSignedUploadUrl(path), bucket.createSignedUploadUrl(thumbPath)]);
    if (!file.data?.signedUrl) return { error: file.error?.message ?? "Storage refused the upload", items: [] };
    items.push({ path, url: file.data.signedUrl, thumbPath, thumbUrl: thumb.data?.signedUrl ?? null });
  }
  return { error: null, items };
}

/** The uploaded takes become the link's job — a new one, or more takes for the one it has. */
export async function shootSend(
  token: string,
  takes: { path: string; name: string; mime: string; size: number; thumbPath: string | null; fansly: boolean }[]
) {
  const found = await linkOf(token);
  if (!found) return { error: "This link is not valid any more", title: null };
  const { db, link } = found;
  const folder = `personas/${link.persona_id}/takes/`;
  if (takes.length === 0) return { error: "Add at least one take", title: null };
  if (takes.some((t) => !t.path.startsWith(folder) || (t.thumbPath && !t.thumbPath.startsWith(folder)))) {
    return { error: "Those takes do not belong here", title: null };
  }

  const { data: model } = await db
    .from("persona_members")
    .select("user_id")
    .eq("persona_id", link.persona_id)
    .eq("role", "model")
    .limit(1)
    .maybeSingle();
  if (!model) return { error: "No model is set up for this persona", title: null };

  let requestId = link.request_id;
  let title: string | null = null;
  if (requestId) {
    const { data: req } = await db.from("content_requests").select("id, title").eq("id", requestId).maybeSingle();
    if (req) title = req.title;
    else requestId = null;
  }
  const isNew = !requestId;
  if (!requestId) {
    const made = await newJob(db, link, model.user_id);
    if (made.error || !made.id) return { error: made.error ?? "Could not make the job", title: null };
    requestId = made.id;
    title = made.title;
  }

  const { error } = await db.from("content_assets").insert(
    takes.map((t) => ({
      request_id: requestId!,
      stage: "raw",
      file_path: t.path,
      file_name: t.name.slice(0, 200),
      mime_type: t.mime,
      size_bytes: t.size,
      thumbnail_path: t.thumbPath,
      fansly: t.fansly,
      uploaded_by: model.user_id,
    }))
  );
  if (error) return { error: error.message, title: null };

  if (isNew) {
    // The link turns 👍 in the requests topic and ✅ on today's list.
    await linkInspoToRequest({ personaId: link.persona_id, requestId: requestId!, inspoUrl: link.url, linkId: link.id });
    if (!link.video_path) waitUntil(fetchRequestInspo(db, requestId!).catch(() => undefined));
  } else {
    await refreshShootList(db, link.persona_id);
  }
  await announceShoot(link.persona_id);
  revalidatePath("/editing");
  revalidatePath(`/requests/${requestId}`);
  return { error: null, title };
}

/** "Reel #N" like every other job, with the link and its notes filled in. */
async function newJob(
  db: ReturnType<typeof createAdminClient>,
  link: { persona_id: string; url: string; note: string | null },
  userId: string
) {
  const [{ data: titles }, { data: top }] = await Promise.all([
    db.from("content_requests").select("title").eq("persona_id", link.persona_id).ilike("title", "Reel #%"),
    db
      .from("content_requests")
      .select("position")
      .eq("persona_id", link.persona_id)
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
  const notes = notePlain(link.note);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("content_requests")
    .insert({
      persona_id: link.persona_id,
      title,
      description: notes || "Self-produced based on inspo",
      inspo_link: link.url,
      content_type_id: null,
      is_nsfw: false,
      status: "shooted",
      shooted_at: now,
      position: (top?.position ?? 0) + 1,
      created_by: userId,
    })
    .select("id")
    .single();
  return { id: data?.id ?? null, title, error: error?.message ?? null };
}
