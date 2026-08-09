"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";

type Leg = "inspo" | "edit" | "post";

/**
 * Move the slow end of one gauge.
 *
 * There is no correct universal answer to "how long is too long" for a
 * pipeline leg — it depends on how many people are on it and what the
 * operation promises. So the number lives in the database and is edited
 * where it is read, rather than being argued about in a settings page far
 * away from the chart it changes.
 */
export async function setSlowBound(leg: Leg, days: number) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return { error: "Give a number of days between 1 and 365" };
  }

  // Spelled out rather than computed, so the column names stay checkable
  // against the generated schema instead of collapsing to a string key.
  const patch =
    leg === "inspo"
      ? { slow_inspo_days: days }
      : leg === "edit"
        ? { slow_edit_days: days }
        : { slow_post_days: days };

  const { error } = await supabase
    .from("telegram_config")
    .upsert(
      { persona_id: personaId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "persona_id" }
    );

  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

/**
 * How often one account posts, and who runs it.
 *
 * Both live on the account rather than on the persona because they differ
 * per account — the whole reason the six-a-day figure was wrong.
 */
export async function setAccountPosting(accountId: string, perDay: number) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  if (!Number.isFinite(perDay) || perDay < 0 || perDay > 50) {
    return { error: "Give a number between 0 and 50" };
  }

  const { error } = await supabase
    .from("accounts")
    .update({ posts_per_day: perDay, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("persona_id", personaId);

  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

export async function setAccountManager(accountId: string, handle: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  const clean = handle.trim().replace(/^@/, "");
  const { error } = await supabase
    .from("accounts")
    .update({
      manager_username: clean === "" ? null : clean,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("persona_id", personaId);

  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}
