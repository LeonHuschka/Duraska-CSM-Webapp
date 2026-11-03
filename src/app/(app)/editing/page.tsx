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
    .select("id, title, status, is_nsfw, is_trial, inspo_link, description, created_at, content_type_id")
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
  if (reqIds.length > 0) {
    const assets = await allRows((from, to) =>
      supabase
        .from("content_assets")
        .select("request_id, stage, fansly, deleted_at")
        .in("request_id", reqIds)
        .order("id")
        .range(from, to)
    );
    for (const a of assets) {
      if (a.stage === "raw") hadTakes.add(a.request_id);
      if (a.deleted_at) continue;
      const c = (countsByReq[a.request_id] ??= { raw: 0, fansly: 0, edited: 0 });
      if (a.stage === "raw") {
        c.raw++;
        if (a.fansly) c.fansly++;
      } else c.edited++;
    }
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
      };
    })
    // Only real edit jobs — skips empty/legacy requests that never got a
    // take uploaded.
    .filter((j) => hadTakes.has(j.id));

  return <EditingView jobs={jobs} />;
}
