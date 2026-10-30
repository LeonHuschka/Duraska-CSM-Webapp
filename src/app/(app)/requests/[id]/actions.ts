"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markInspoEdited } from "@/lib/content-links";

export async function createAssetRecord(data: {
  request_id: string;
  stage: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_path?: string | null;
  /** A raw take shot in a Fansly outfit. */
  fansly?: boolean;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("content_assets").insert({
    request_id: data.request_id,
    stage: data.stage,
    file_path: data.file_path,
    file_name: data.file_name,
    mime_type: data.mime_type,
    size_bytes: data.size_bytes,
    thumbnail_path: data.thumbnail_path ?? null,
    fansly: data.fansly ?? false,
    uploaded_by: user.id,
  });

  if (error) throw new Error(error.message);

  // A final cut landing means the job is edited — tell the Telegram group.
  if (data.stage === "edited" || data.stage === "final") {
    await markInspoEdited(data.request_id);
  }

  revalidatePath(`/requests/${data.request_id}`);
  revalidatePath("/requests");
  revalidatePath("/editing");
}

/** Move a raw take between the Instagram and the Fansly pile. */
export async function setAssetFansly(assetId: string, requestId: string, fansly: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("content_assets").update({ fansly }).eq("id", assetId);
  if (error) throw new Error(error.message);
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/editing");
}

export async function deleteAsset(assetId: string, requestId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Get the asset to find its file_path before soft-deleting
  const { data: asset, error: fetchError } = await supabase
    .from("content_assets")
    .select("file_path")
    .eq("id", assetId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // Soft-delete the asset record
  const { error } = await supabase
    .from("content_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", assetId);

  if (error) throw new Error(error.message);

  // Delete from storage
  if (asset?.file_path) {
    await supabase.storage.from("content-assets").remove([asset.file_path]);
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
}

export async function updateRequestDetail(
  requestId: string,
  data: {
    description?: string;
    priority?: string;
    due_date?: string;
    status?: string;
    inspo_link?: string;
    is_nsfw?: boolean;
    is_trial?: boolean;
  }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("content_requests")
    .update({
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      due_date: data.due_date || null,
      inspo_link: data.inspo_link || null,
      is_nsfw: data.is_nsfw ?? false,
      ...(data.is_trial !== undefined ? { is_trial: data.is_trial } : {}),
      updated_at: now,
      ...(data.status === "shooted" ? { shooted_at: now } : {}),
    })
    .eq("id", requestId);

  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
}

export type EditNote = { id: string; text: string; done: boolean };

/** The editor's to-do list on a job — written by the team, ticked by the editor. */
export async function saveEditNotes(requestId: string, notes: EditNote[]) {
  const supabase = await createClient();
  const clean = notes
    .map((n) => ({ id: String(n.id), text: String(n.text).trim().slice(0, 500), done: !!n.done }))
    .filter((n) => n.text);
  const { error } = await supabase.from("content_requests").update({ edit_notes: clean }).eq("id", requestId);
  if (error) return { error: error.message };
  return { error: null };
}
