"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActivePersonaId } from "@/lib/persona";
import { scrapeAccounts, type ScrapeSummary } from "@/lib/account-scrape";

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


/** Owners and managers only — the people who run the accounts. */
async function requireStaff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personaId: string
): Promise<{ userId: string } | { error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase
      .from("persona_members")
      .select("role")
      .eq("persona_id", personaId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const ok =
    profile?.global_role === "owner" ||
    membership?.role === "owner" ||
    membership?.role === "manager";
  return ok ? { userId: user.id } : { error: "Only owners and managers can do that" };
}

/**
 * Today's numbers, now. The same read the 7:17 run does, for the moment
 * somebody has just fixed a handle or added an account and wants to see
 * it work rather than wait for tomorrow.
 */
export async function scrapeAccountsNow(): Promise<{
  error: string | null;
  summary?: ScrapeSummary;
}> {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };

  const summary = await scrapeAccounts(createAdminClient(), personaId);
  revalidatePath("/");
  return { error: null, summary };
}

/** Add a posting account from the dashboard, manager included. */
export async function addPostingAccount(data: {
  platform: string;
  handle: string;
  manager?: string;
}) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };

  const handle = data.handle.trim().replace(/^@/, "");
  if (!handle) return { error: "Handle is required" };
  const manager = (data.manager ?? "").trim().replace(/^@/, "");

  const { error } = await supabase.from("accounts").insert({
    persona_id: personaId,
    platform: data.platform,
    handle,
    status: "graduated",
    manager_username: manager === "" ? null : manager,
    created_by: who.userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/");
  revalidatePath("/settings/accounts");
  revalidatePath("/vault");
  return { error: null };
}

/**
 * The handle is what the scrape reads the account by, so a placeholder
 * like "Lyza tbd" means the account is never read. Editable on the card,
 * where the empty row makes it obvious something is wrong.
 */
export async function setAccountHandle(accountId: string, handle: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const clean = handle.trim().replace(/^@/, "");
  if (!clean) return { error: "A handle is required" };
  const { error } = await supabase
    .from("accounts")
    .update({ handle: clean, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  revalidatePath("/vault");
  return { error: null };
}
