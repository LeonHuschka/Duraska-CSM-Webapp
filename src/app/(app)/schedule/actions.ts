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

// Schedule slots

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

  if (error) return { error: error.message };
  revalidatePath("/schedule");
  return { error: null };
}

export async function scheduleRequestToSlot(data: {
  request_id: string;
  scheduled_for: string;
  platform: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  // Check if a slot already exists for this exact time
  const { data: existing } = await supabase
    .from("schedule_slots")
    .select("id")
    .eq("persona_id", personaId)
    .eq("scheduled_for", data.scheduled_for)
    .maybeSingle();

  if (existing) {
    // Update existing slot with the request
    const { error } = await supabase
      .from("schedule_slots")
      .update({
        request_id: data.request_id,
        platform: data.platform,
        status: "ready",
      })
      .eq("id", existing.id);

    if (error) return { error: error.message };
  } else {
    // Create new slot
    const { error } = await supabase.from("schedule_slots").insert({
      persona_id: personaId,
      platform: data.platform,
      scheduled_for: data.scheduled_for,
      request_id: data.request_id,
      status: "ready",
    });

    if (error) return { error: error.message };
  }

  // Update request status to scheduled
  await supabase
    .from("content_requests")
    .update({ status: "scheduled", updated_at: new Date().toISOString() })
    .eq("id", data.request_id);

  revalidatePath("/schedule");
  return { error: null };
}

export async function unscheduleSlot(slotId: string) {
  const supabase = await createClient();

  // Get the slot to find the request_id
  const { data: slot } = await supabase
    .from("schedule_slots")
    .select("request_id")
    .eq("id", slotId)
    .single();

  // Delete the slot
  const { error } = await supabase
    .from("schedule_slots")
    .delete()
    .eq("id", slotId);

  if (error) return { error: error.message };

  // Revert request status back to edited
  if (slot?.request_id) {
    await supabase
      .from("content_requests")
      .update({ status: "edited", updated_at: new Date().toISOString() })
      .eq("id", slot.request_id);
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

  if (error) return { error: error.message };
  revalidatePath("/schedule");
  return { error: null };
}

export async function deleteSlot(slotId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("schedule_slots")
    .delete()
    .eq("id", slotId);

  if (error) return { error: error.message };
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

  if (error) return { error: error.message };
  revalidatePath("/schedule");
  return { error: null };
}

// Posting timeslots (templates)

export async function getPostingTimeslots() {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { data, error } = await supabase
    .from("posting_timeslots")
    .select("*")
    .eq("persona_id", personaId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function seedDefaultTimeslots() {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { count } = await supabase
    .from("posting_timeslots")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId);

  if ((count ?? 0) > 0) return;

  // Default times in UTC (converted from CET: +1 in winter, +2 in summer)
  // CET times: 5:00, 7:00, 9:00, 17:00, 23:00
  // UTC equivalents (CET = UTC+1 standard): 04:00, 06:00, 08:00, 16:00, 22:00
  const defaults = [
    { time_utc: "04:00:00", label: "Early Morning" },
    { time_utc: "06:00:00", label: "Morning" },
    { time_utc: "08:00:00", label: "Mid Morning" },
    { time_utc: "16:00:00", label: "Afternoon" },
    { time_utc: "22:00:00", label: "Night" },
  ];

  const { error } = await supabase.from("posting_timeslots").insert(
    defaults.map((d, i) => ({
      persona_id: personaId,
      time_utc: d.time_utc,
      label: d.label,
      platform: "fansly",
      position: i,
    }))
  );

  if (error) throw new Error(error.message);
  revalidatePath("/schedule");
}

export async function addTimeslot(time_utc: string, label?: string, platform?: string) {
  const supabase = await createClient();
  const personaId = await getPersonaId();

  const { error } = await supabase.from("posting_timeslots").insert({
    persona_id: personaId,
    time_utc,
    label: label || null,
    platform: platform || "fansly",
    position: Date.now(),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/schedule");
}

export async function removeTimeslot(id: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("posting_timeslots")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/schedule");
}

export async function updateTimeslot(
  id: string,
  data: { time_utc?: string; label?: string; platform?: string }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("posting_timeslots")
    .update(data)
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/schedule");
}
