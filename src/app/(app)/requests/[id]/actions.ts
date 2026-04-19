"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createAssetRecord(data: {
  request_id: string;
  stage: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
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
    uploaded_by: user.id,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${data.request_id}`);
  revalidatePath("/requests");
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
  }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("content_requests")
    .update({
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      due_date: data.due_date || null,
      inspo_link: data.inspo_link || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
}
