"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";

async function getPersonaId(): Promise<string> {
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  if (!personaId) throw new Error("No active persona selected");
  return personaId;
}

export async function createRequest(data: {
  content_type_id: string;
  description?: string;
  priority?: string;
  due_date?: string;
  inspo_link?: string;
  is_nsfw?: boolean;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contentType } = await supabase
    .from("content_types")
    .select("name")
    .eq("id", data.content_type_id)
    .single();

  if (!contentType) throw new Error("Content type not found");

  const { count } = await supabase
    .from("content_requests")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("content_type_id", data.content_type_id);

  const nextNumber = (count ?? 0) + 1;
  const title = `${contentType.name} #${nextNumber}`;

  const { error } = await supabase.from("content_requests").insert({
    persona_id: personaId,
    title,
    content_type_id: data.content_type_id,
    description: data.description || null,
    priority: data.priority || "medium",
    due_date: data.due_date || null,
    inspo_link: data.inspo_link || null,
    is_nsfw: data.is_nsfw ?? false,
    created_by: user.id,
    position: Date.now(),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

export async function createEditedRequests(data: {
  content_type_id: string;
  count: number;
  priority?: string;
  is_nsfw?: boolean;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contentType } = await supabase
    .from("content_types")
    .select("name")
    .eq("id", data.content_type_id)
    .single();

  if (!contentType) throw new Error("Content type not found");

  // Get current count for numbering
  const { count: existing } = await supabase
    .from("content_requests")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("content_type_id", data.content_type_id);

  const startNumber = (existing ?? 0) + 1;
  const rows = Array.from({ length: data.count }, (_, i) => ({
    persona_id: personaId,
    title: `${contentType.name} #${startNumber + i}`,
    content_type_id: data.content_type_id,
    description: null,
    priority: data.priority || "medium",
    due_date: null,
    inspo_link: null,
    is_nsfw: data.is_nsfw ?? false,
    status: "edited",
    created_by: user.id,
    position: Date.now() + i,
  }));

  const { error } = await supabase.from("content_requests").insert(rows);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
  revalidatePath("/schedule");
}

export async function updateRequestStatus(
  requestId: string,
  newStatus: string
) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_requests")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

export async function updateRequest(
  requestId: string,
  data: {
    description?: string;
    priority?: string;
    due_date?: string;
    inspo_link?: string;
  }
) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_requests")
    .update({
      description: data.description || null,
      priority: data.priority,
      due_date: data.due_date || null,
      inspo_link: data.inspo_link || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

export async function updateRequestPosition(
  requestId: string,
  newPosition: number,
  newStatus?: string
) {
  const supabase = await createClient();
  await getPersonaId();

  // If moving away from "scheduled", delete the associated schedule slot
  if (newStatus && newStatus !== "scheduled") {
    const { data: currentRequest } = await supabase
      .from("content_requests")
      .select("status")
      .eq("id", requestId)
      .single();

    if (currentRequest?.status === "scheduled") {
      await supabase
        .from("schedule_slots")
        .delete()
        .eq("request_id", requestId);
    }
  }

  const { error } = await supabase
    .from("content_requests")
    .update({
      position: newPosition,
      ...(newStatus ? { status: newStatus } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
  revalidatePath("/schedule");
}

export async function deleteRequest(requestId: string) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_requests")
    .delete()
    .eq("id", requestId);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

// Content type management

export async function getContentTypes() {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { data, error } = await supabase
    .from("content_types")
    .select("*")
    .eq("persona_id", personaId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createContentType(name: string) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { data, error } = await supabase
    .from("content_types")
    .insert({ persona_id: personaId, name, position: Date.now() })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
  return data;
}

export async function renameContentType(id: string, name: string) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_types")
    .update({ name })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

export async function deleteContentType(id: string) {
  const supabase = await createClient();
  await getPersonaId();

  const { error } = await supabase
    .from("content_types")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}

export async function seedDefaultContentTypes() {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { count } = await supabase
    .from("content_types")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId);

  if ((count ?? 0) > 0) return;

  const defaults = ["Boyfriend", "Roleplay", "Posing", "Speaking", "Dancing", "Stretching"];
  const { error } = await supabase.from("content_types").insert(
    defaults.map((name, i) => ({
      persona_id: personaId,
      name,
      position: i,
    }))
  );

  if (error) throw new Error(error.message);
  revalidatePath("/requests");
}
