import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { EditingView } from "@/components/editing/editing-view";

export interface EditJob {
  id: string;
  title: string;
  status: string;
  is_nsfw: boolean;
  is_trial: boolean;
  inspo_link: string | null;
  created_at: string;
  content_type_name: string | null;
  rawCount: number;
  editedCount: number;
  // first raw thumbnail for the card preview
  thumbnailUrl: string | null;
}

export default async function EditingPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to view editing jobs.</p>
      </div>
    );
  }

  // Jobs relevant to editing: shooted (needs edit), edited (done, review),
  // posted (archive-ish). We show shooted + edited primarily.
  const { data: requests } = await supabase
    .from("content_requests")
    .select("id, title, status, is_nsfw, is_trial, inspo_link, created_at, content_type_id")
    .eq("persona_id", personaId)
    .in("status", ["shooted", "edited", "posted"])
    .order("created_at", { ascending: false })
    .limit(500);

  const reqIds = (requests ?? []).map((r) => r.id);

  // Content type names
  const { data: types } = await supabase
    .from("content_types")
    .select("id, name")
    .eq("persona_id", personaId);
  const typeName = Object.fromEntries((types ?? []).map((t) => [t.id, t.name]));

  // Asset counts + first raw thumbnail per request
  const countsByReq: Record<string, { raw: number; edited: number }> = {};
  const firstRawThumbPath: Record<string, string | null> = {};
  if (reqIds.length > 0) {
    const { data: assets } = await supabase
      .from("content_assets")
      .select("request_id, stage, thumbnail_path, uploaded_at")
      .in("request_id", reqIds)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: true });
    for (const a of assets ?? []) {
      const c = (countsByReq[a.request_id] ??= { raw: 0, edited: 0 });
      if (a.stage === "raw") c.raw++;
      else c.edited++;
      if (a.stage === "raw" && !(a.request_id in firstRawThumbPath)) {
        firstRawThumbPath[a.request_id] = a.thumbnail_path;
      }
    }
  }

  // Sign the preview thumbnails in one batch
  const thumbPaths = Object.values(firstRawThumbPath).filter(Boolean) as string[];
  const urlByPath: Record<string, string> = {};
  if (thumbPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(thumbPaths, 3600);
    for (const r of signed ?? []) if (r.path) urlByPath[r.path] = r.signedUrl ?? "";
  }

  const jobs: EditJob[] = (requests ?? []).map((r) => {
    const counts = countsByReq[r.id] ?? { raw: 0, edited: 0 };
    const tp = firstRawThumbPath[r.id];
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      is_nsfw: r.is_nsfw,
      is_trial: r.is_trial,
      inspo_link: r.inspo_link,
      created_at: r.created_at,
      content_type_name: r.content_type_id ? typeName[r.content_type_id] ?? null : null,
      rawCount: counts.raw,
      editedCount: counts.edited,
      thumbnailUrl: tp ? urlByPath[tp] ?? null : null,
    };
  });

  return <EditingView jobs={jobs} />;
}
