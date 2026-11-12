"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { isRepeat, type RepeatKey } from "@/lib/checklist";

/**
 * The team's to-do list on the pipeline dashboard. Owners and managers
 * write and tick it; the table's policy keeps everyone else out.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

async function staff(supabase: Sb, personaId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const ok = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  return ok ? user.id : null;
}

async function ctx() {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const userId = await staff(supabase, personaId);
  return { supabase, personaId, userId };
}

const done = (error: { message: string } | null) => {
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
};

export async function addTeamTodo(text: string, repeat: RepeatKey = "all") {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return { error: "Only owners and managers" };
  const clean = text.trim().slice(0, 300);
  if (!clean) return { error: "Write something first" };
  const { data: last } = await supabase
    .from("team_todos")
    .select("position")
    .eq("persona_id", personaId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("team_todos").insert({
    persona_id: personaId,
    text: clean,
    repeat: isRepeat(repeat) ? repeat : "all",
    position: (last?.position ?? 0) + 1,
    created_by: userId,
  });
  return done(error);
}

export async function toggleTeamTodo(id: string, on: boolean) {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return { error: "Only owners and managers" };
  const { error } = await supabase
    .from("team_todos")
    .update({ done: on, done_at: on ? new Date().toISOString() : null, done_by: on ? userId : null })
    .eq("id", id)
    .eq("persona_id", personaId);
  return done(error);
}

export async function editTeamTodo(id: string, text: string) {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return { error: "Only owners and managers" };
  const clean = text.trim().slice(0, 300);
  if (!clean) return { error: "An entry needs words" };
  const { error } = await supabase.from("team_todos").update({ text: clean }).eq("id", id).eq("persona_id", personaId);
  return done(error);
}

export async function setTeamTodoRepeat(id: string, repeat: RepeatKey) {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return { error: "Only owners and managers" };
  if (!isRepeat(repeat)) return { error: "Unknown repeat" };
  const { error } = await supabase.from("team_todos").update({ repeat }).eq("id", id).eq("persona_id", personaId);
  return done(error);
}

export async function deleteTeamTodo(id: string) {
  const { supabase, personaId, userId } = await ctx();
  if (!userId) return { error: "Only owners and managers" };
  const { error } = await supabase.from("team_todos").delete().eq("id", id).eq("persona_id", personaId);
  return done(error);
}
