"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { isRepeat, type RepeatKey } from "@/lib/checklist";

/**
 * The model's checklist. Owners and managers write the entries; anyone on
 * the persona — the model above all — ticks them off.
 */

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

export async function addChecklistItem(text: string, repeat: RepeatKey = "1d") {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can add entries" };
  const clean = text.trim().slice(0, 300);
  if (!clean) return { error: "Write something first" };
  const { data: last } = await supabase
    .from("checklist_items")
    .select("position")
    .eq("persona_id", personaId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("checklist_items")
    .insert({ persona_id: personaId, text: clean, repeat: isRepeat(repeat) ? repeat : "1d", position: (last?.position ?? 0) + 1, created_by: me.userId });
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

export async function editChecklistItem(id: string, text: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can edit entries" };
  const clean = text.trim().slice(0, 300);
  if (!clean) return { error: "An entry needs words" };
  const { error } = await supabase.from("checklist_items").update({ text: clean }).eq("id", id).eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

export async function setChecklistRepeat(id: string, repeat: RepeatKey) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can change entries" };
  if (!isRepeat(repeat)) return { error: "Unknown repeat" };
  const { error } = await supabase.from("checklist_items").update({ repeat }).eq("id", id).eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

export async function deleteChecklistItem(id: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.staff) return { error: "Only owners and managers can remove entries" };
  const { error } = await supabase.from("checklist_items").delete().eq("id", id).eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

export async function toggleChecklistItem(id: string, done: boolean) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const me = await who(supabase, personaId);
  if (!me?.member) return { error: "Not on this persona" };
  const { error } = await supabase
    .from("checklist_items")
    .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? me.userId : null })
    .eq("id", id)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}
