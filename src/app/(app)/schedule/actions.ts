"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";

async function getPersonaId() {
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  if (!personaId) throw new Error("No active persona selected");
  return personaId;
}

export async function createSlot(data: {
  platform: string;
  scheduled_for: string;
  caption?: string;
  request_id?: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { error } = await supabase.from("schedule_slots").insert({
    persona_id: personaId,
    platform: data.platform,
    scheduled_for: data.scheduled_for,
    caption: data.caption || null,
    request_id: data.request_id || null,
    status: "planned",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schedule");
  return { error: null };
}

export async function updateSlot(
  slotId: string,
  data: {
    platform?: string;
    scheduled_for?: string;
    caption?: string;
    request_id?: string | null;
    status?: string;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("schedule_slots")
    .update(data)
    .eq("id", slotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schedule");
  return { error: null };
}

export async function deleteSlot(slotId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("schedule_slots")
    .delete()
    .eq("id", slotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schedule");
  return { error: null };
}

export async function markSlotPosted(slotId: string, postedUrl?: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("schedule_slots")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      ...(postedUrl ? { post_url: postedUrl } : {}),
    })
    .eq("id", slotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schedule");
  return { error: null };
}
