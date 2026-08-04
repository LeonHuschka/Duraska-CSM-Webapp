"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";

/**
 * Delete a whole edit job: the request, its assets (cascade) and — the part
 * the old deleteRequest forgot — the actual files in Storage, which would
 * otherwise sit there orphaned forever.
 *
 * RLS already restricts deletes to owner/manager/model (VAs can't), so this
 * is safe to expose; we still scope the lookup to the active persona.
 */
export async function deleteEditJob(requestId: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  // Confirm the job belongs to this persona before touching anything.
  const { data: request } = await supabase
    .from("content_requests")
    .select("id, title")
    .eq("id", requestId)
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!request) return { error: "Job not found" };

  // Collect every stored file for this job (including soft-deleted rows,
  // whose blobs may still be around).
  const { data: assets } = await supabase
    .from("content_assets")
    .select("file_path, thumbnail_path")
    .eq("request_id", requestId);

  const paths = (assets ?? [])
    .flatMap((a) => [a.file_path, a.thumbnail_path])
    .filter(Boolean) as string[];

  if (paths.length > 0) {
    const { error: storageErr } = await supabase.storage
      .from("content-assets")
      .remove(paths);
    // Non-fatal: if storage cleanup fails we still remove the job rather
    // than leaving a half-deleted state in the UI.
    if (storageErr) {
      console.warn("[deleteEditJob] storage cleanup failed", storageErr.message);
    }
  }

  const { error } = await supabase
    .from("content_requests")
    .delete()
    .eq("id", requestId);
  if (error) return { error: error.message };

  revalidatePath("/editing");
  revalidatePath("/vault");
  revalidatePath("/");
  return { error: null, title: request.title };
}
