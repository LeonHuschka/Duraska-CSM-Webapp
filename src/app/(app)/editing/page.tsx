import { getActivePersonaId } from "@/lib/persona";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/supabase/all-rows";
import { EditingView } from "@/components/editing/editing-view";

export interface EditJob {
  id: string;
  title: string;
  status: string;
  is_nsfw: boolean;
  is_trial: boolean;
  inspo_link: string | null;
  description: string | null;
  created_at: string;
  content_type_name: string | null;
  rawCount: number;
  /** Of the raw takes, the ones shot in a Fansly outfit. */
  fanslyCount: number;
  editedCount: number;
  /** The inspo reel kept by the bot, signed — or a take's thumbnail. */
  previewVideo: string | null;
  previewImage: string | null;
}

export default async function EditingPage() {
  const supabase = await createClient();
  const personaId = await getActivePersonaId();

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to view editing jobs.</p>
      </div>
    );
  }

  // Jobs relevant to editing: shooted (needs edit), edited (done, review),
  // posted (archive-ish). "Scheduled" — a cut of it is planned or marked
  // posted on an account — is done editing and shows under Done, so a job
  // never drops off the board once its cuts start going out.
  const { data: requests } = await supabase
    .from("content_requests")
    .select("id, title, status, is_nsfw, is_trial, inspo_link, inspo_video_path, description, created_at, content_type_id")
    .eq("persona_id", personaId)
    .in("status", ["shooted", "edited", "scheduled", "posted"])
    .order("created_at", { ascending: false })
    .limit(500);

  const reqIds = (requests ?? []).map((r) => r.id);

  // Content type names
  const { data: types } = await supabase
    .from("content_types")
    .select("id, name")
    .eq("persona_id", personaId);
  const typeName = Object.fromEntries((types ?? []).map((t) => [t.id, t.name]));

  // Asset counts per request (raw takes vs final cuts)
  const countsByReq: Record<string, { raw: number; fansly: number; edited: number }> = {};
  // Jobs that ever had a take, deleted ones included — emptying a job to
  // reshoot it must not make it vanish.
  const hadTakes = new Set<string>();
  const thumbByReq: Record<string, string> = {};
  if (reqIds.length > 0) {
    const assets = await allRows((from, to) =>
      supabase
        .from("content_assets")
        .select("request_id, stage, fansly, deleted_at, thumbnail_path, uploaded_at")
        .in("request_id", reqIds)
        .order("id")
        .range(from, to)
    );
    for (const a of assets) {
      if (a.stage === "raw") hadTakes.add(a.request_id);
      if (a.deleted_at) continue;
      if (a.thumbnail_path && !thumbByReq[a.request_id]) thumbByReq[a.request_id] = a.thumbnail_path;
      const c = (countsByReq[a.request_id] ??= { raw: 0, fansly: 0, edited: 0 });
      if (a.stage === "raw") {
        c.raw++;
        if (a.fansly) c.fansly++;
      } else c.edited++;
    }
  }

  // The inspo reel per job, as the bot kept it: through the link tied to
  // the job, else the copy on the job itself.
  const inspoByReq: Record<string, string> = {};
  if (reqIds.length > 0) {
    const links = await allRows((from, to) =>
      supabase
        .from("content_links")
        .select("request_id, video_path")
        .in("request_id", reqIds)
        .not("video_path", "is", null)
        .order("id")
        .range(from, to)
    );
    for (const l of links) if (l.request_id && l.video_path) inspoByReq[l.request_id] ??= l.video_path;
  }
  for (const r of requests ?? []) if (r.inspo_video_path) inspoByReq[r.id] ??= r.inspo_video_path;
  const paths = Array.from(new Set([...Object.values(inspoByReq), ...Object.values(thumbByReq)]));
  const signedBy: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 500) {
    const { data: signed } = await supabase.storage.from("content-assets").createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const x of signed ?? []) if (x.path && x.signedUrl) signedBy[x.path] = x.signedUrl;
  }

  const jobs: EditJob[] = (requests ?? [])
    .map((r) => {
      const counts = countsByReq[r.id] ?? { raw: 0, fansly: 0, edited: 0 };
      return {
        id: r.id,
        title: r.title,
        status: r.status === "scheduled" ? "edited" : r.status,
        is_nsfw: r.is_nsfw,
        is_trial: r.is_trial,
        inspo_link: r.inspo_link,
        description: r.description,
        created_at: r.created_at,
        content_type_name: r.content_type_id ? typeName[r.content_type_id] ?? null : null,
        rawCount: counts.raw,
        fanslyCount: counts.fansly,
        editedCount: counts.edited,
        previewVideo: inspoByReq[r.id] ? signedBy[inspoByReq[r.id]] ?? null : null,
        previewImage: thumbByReq[r.id] ? signedBy[thumbByReq[r.id]] ?? null : null,
      };
    })
    // Only real edit jobs — skips empty/legacy requests that never got a
    // take uploaded.
    .filter((j) => hadTakes.has(j.id));

  return <EditingView jobs={jobs} />;
}
