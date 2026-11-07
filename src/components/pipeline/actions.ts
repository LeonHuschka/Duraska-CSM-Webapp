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
  if ("error" in who) return { error: who.error, id: null };

  const handle = data.handle.trim().replace(/^@/, "");
  if (!handle) return { error: "Handle is required", id: null };
  const manager = (data.manager ?? "").trim().replace(/^@/, "");

  const { data: row, error } = await supabase
    .from("accounts")
    .insert({
      persona_id: personaId,
      platform: data.platform,
      handle,
      status: "graduated",
      manager_username: manager === "" ? null : manager,
      created_by: who.userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message, id: null };
  revalidatePath("/");
  revalidatePath("/settings/accounts");
  revalidatePath("/vault");
  return { error: null, id: row.id };
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

/** The order a manager dragged the account tiles into. */
export async function setAccountOrder(ids: string[]) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  const results = await Promise.all(
    ids.map((id, i) =>
      supabase.from("accounts").update({ sort_order: i + 1 }).eq("id", id).eq("persona_id", personaId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  revalidatePath("/");
  return { error: null };
}

/**
 * The other half of a Meta setup. Linked both ways, and whatever either
 * account was linked to before is let go, so a pair is always a pair.
 */
export async function setAccountLink(accountId: string, otherId: string | null) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  if (otherId === accountId) return { error: "An account cannot be linked to itself" };

  const ids = [accountId, ...(otherId ? [otherId] : [])];
  const { data: rows } = await supabase
    .from("accounts")
    .select("id, linked_account_id")
    .eq("persona_id", personaId)
    .in("id", ids);
  if ((rows ?? []).length !== ids.length) return { error: "No such account" };

  // Let go of the old partners.
  const old = (rows ?? []).map((r) => r.linked_account_id).filter((x): x is string => !!x);
  if (old.length) {
    await supabase.from("accounts").update({ linked_account_id: null }).eq("persona_id", personaId).in("id", old);
  }
  await supabase.from("accounts").update({ linked_account_id: otherId }).eq("id", accountId).eq("persona_id", personaId);
  if (otherId) {
    await supabase.from("accounts").update({ linked_account_id: accountId }).eq("id", otherId).eq("persona_id", personaId);
  }
  revalidatePath("/");
  return { error: null };
}

/**
 * An account the platform has disabled. "dead" is the status every part of
 * the app already leaves out — the scrape, the stock and runway figures,
 * the vault — so one switch takes it out of all of them. Undone with
 * "graduated", the status of an account that is posting.
 */
export async function setAccountDisabled(accountId: string, disabled: boolean) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  const { error } = await supabase
    .from("accounts")
    .update({ status: disabled ? "dead" : "graduated", updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

/**
 * Paused by us: the account posts nothing any more but stays up — out of
 * the daily read, the charts, winners and trials; read on Sundays in case
 * an old reel takes off again. Resuming makes it a posting account again.
 */
export async function setAccountPaused(accountId: string, paused: boolean) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  const { error } = await supabase
    .from("accounts")
    .update({ status: paused ? "paused" : "graduated", updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: null };
}

/**
 * Everything a person sets on an account, saved at once from the open
 * tile: the name it goes by here, the handle the scrape reads it by, who
 * runs it, and how many reels a day it posts.
 */
export async function updateAccountSettings(
  accountId: string,
  data: {
    displayName: string;
    handle: string;
    manager: string;
    perDay: number;
    trialPerDay: number;
    storiesPerDay: number;
  }
) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };

  const handle = data.handle.trim().replace(/^@/, "");
  if (!handle) return { error: "A handle or page URL is required" };
  if (!Number.isFinite(data.perDay) || data.perDay < 0 || data.perDay > 50) {
    return { error: "Reels a day: a number between 0 and 50" };
  }
  if (!Number.isFinite(data.trialPerDay) || data.trialPerDay < 0 || data.trialPerDay > 50) {
    return { error: "Trial reels a day: a number between 0 and 50" };
  }
  if (!Number.isFinite(data.storiesPerDay) || data.storiesPerDay < 0 || data.storiesPerDay > 50) {
    return { error: "Stories a day: a number between 0 and 50" };
  }
  const manager = data.manager.trim().replace(/^@/, "");
  const name = data.displayName.trim().slice(0, 60);
  const { error } = await supabase
    .from("accounts")
    .update({
      display_name: name || null,
      handle,
      manager_username: manager || null,
      posts_per_day: Math.round(data.perDay),
      trial_reels_per_day: Math.round(data.trialPerDay),
      stories_per_day: Math.round(data.storiesPerDay),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/");
  revalidatePath("/vault");
  return { error: null };
}
