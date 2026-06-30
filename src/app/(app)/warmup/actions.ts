"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import {
  generateWarmupSlots,
  WARMUP_DURATION_DAYS,
  type WarmupPlatform,
} from "@/lib/warmup-spec";

async function getPersonaId() {
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  if (!personaId) throw new Error("No active persona selected");
  return personaId;
}

/**
 * Create a new account + pre-generate its full warm-up slot plan.
 */
export async function createAccount(data: {
  platform: WarmupPlatform;
  handle: string;
  display_name?: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", account_id: null };

  const { data: account, error } = await supabase
    .from("accounts")
    .insert({
      persona_id: personaId,
      platform: data.platform,
      handle: data.handle.trim(),
      display_name: data.display_name?.trim() || null,
      status: "warmup",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !account) {
    return { error: error?.message ?? "Insert failed", account_id: null };
  }

  // Pre-generate all warm-up slots
  const planned = generateWarmupSlots(data.platform);
  if (planned.length > 0) {
    const rows = planned.map((p) => ({
      account_id: account.id,
      day_number: p.day_number,
      position: p.position,
      asset_kind: p.asset_kind,
      notes: p.notes ?? null,
      status: "pending",
    }));
    // Insert in chunks to stay under payload limits
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: slotErr } = await supabase
        .from("warmup_slots")
        .insert(rows.slice(i, i + CHUNK));
      if (slotErr) {
        return { error: slotErr.message, account_id: account.id };
      }
    }
  }

  revalidatePath("/warmup");
  return { error: null, account_id: account.id };
}

/**
 * Manually override which warm-up day the account is currently on.
 * Implemented by shifting warmup_started_at so that
 * "today = start + (day-1)" — keeps the due-today / overdue logic intact.
 */
export async function setWarmupDay(accountId: string, day: number) {
  const supabase = await createClient();
  const clamped = Math.max(1, Math.min(WARMUP_DURATION_DAYS, Math.round(day)));
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  // Anchor to local midnight-ish: start = now - (day-1) days
  const startedAt = new Date(Date.now() - (clamped - 1) * MS_PER_DAY).toISOString();
  const { error } = await supabase
    .from("accounts")
    .update({ warmup_started_at: startedAt, updated_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) return { error: error.message };
  revalidatePath("/warmup");
  revalidatePath(`/warmup/${accountId}`);
  return { error: null };
}

export async function updateAccount(
  accountId: string,
  data: {
    handle?: string;
    display_name?: string | null;
    status?: string;
    notes?: string | null;
  }
) {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("accounts")
    .update({
      ...data,
      updated_at: now,
      ...(data.status === "graduated" ? { warmup_completed_at: now } : {}),
    })
    .eq("id", accountId);
  if (error) return { error: error.message };
  revalidatePath("/warmup");
  revalidatePath(`/warmup/${accountId}`);
  return { error: null };
}

export async function deleteAccount(accountId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .delete()
    .eq("id", accountId);
  if (error) return { error: error.message };
  revalidatePath("/warmup");
  return { error: null };
}

/**
 * Persist directly-uploaded media on a slot. The client uploads the file
 * (and optional thumbnail) to Storage first, then calls this with the
 * resulting paths. Marks the slot ready.
 */
export async function saveSlotMedia(
  slotId: string,
  data: {
    file_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    thumbnail_path: string | null;
  }
) {
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("warmup_slots")
    .select("account_id")
    .eq("id", slotId)
    .single();
  const { error } = await supabase
    .from("warmup_slots")
    .update({
      file_path: data.file_path,
      file_name: data.file_name,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      thumbnail_path: data.thumbnail_path,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  if (slot?.account_id) revalidatePath(`/warmup/${slot.account_id}`);
  return { error: null };
}

/** Remove the uploaded media from a slot (also deletes from storage). */
export async function clearSlotMedia(slotId: string) {
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("warmup_slots")
    .select("account_id, file_path, thumbnail_path")
    .eq("id", slotId)
    .single();

  // Best-effort storage cleanup
  const paths = [slot?.file_path, slot?.thumbnail_path].filter(Boolean) as string[];
  if (paths.length > 0) {
    await supabase.storage.from("content-assets").remove(paths);
  }

  const { error } = await supabase
    .from("warmup_slots")
    .update({
      file_path: null,
      file_name: null,
      mime_type: null,
      size_bytes: null,
      thumbnail_path: null,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  if (slot?.account_id) revalidatePath(`/warmup/${slot.account_id}`);
  return { error: null };
}

/** Save bio text directly on a bio slot. */
export async function saveSlotText(slotId: string, text: string) {
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("warmup_slots")
    .select("account_id")
    .eq("id", slotId)
    .single();
  const { error } = await supabase
    .from("warmup_slots")
    .update({
      text_content: text,
      status: text.trim() ? "ready" : "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  if (slot?.account_id) revalidatePath(`/warmup/${slot.account_id}`);
  return { error: null };
}

/** Mark a slot posted / unposted. */
export async function setSlotPosted(slotId: string, posted: boolean) {
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("warmup_slots")
    .select("account_id, file_path, text_content")
    .eq("id", slotId)
    .single();

  const status = posted
    ? "posted"
    : slot?.file_path || slot?.text_content
      ? "ready"
      : "pending";

  const { error } = await supabase
    .from("warmup_slots")
    .update({
      status,
      posted_at: posted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId);
  if (error) return { error: error.message };
  if (slot?.account_id) revalidatePath(`/warmup/${slot.account_id}`);
  revalidatePath("/warmup");
  return { error: null };
}

/** Skip a slot (e.g. only did 2 of 3 stories that day). */
export async function setSlotSkipped(slotId: string, skipped: boolean) {
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("warmup_slots")
    .select("account_id, file_path, text_content")
    .eq("id", slotId)
    .single();
  const status = skipped
    ? "skipped"
    : slot?.file_path || slot?.text_content
      ? "ready"
      : "pending";
  const { error } = await supabase
    .from("warmup_slots")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", slotId);
  if (error) return { error: error.message };
  if (slot?.account_id) revalidatePath(`/warmup/${slot.account_id}`);
  return { error: null };
}
