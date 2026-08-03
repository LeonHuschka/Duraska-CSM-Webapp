"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";

// Cookie when valid, otherwise the user's first membership. Mobile users
// never get the cookie set (no persona switcher on phones), so relying on
// it alone used to break uploads entirely.
async function getPersonaId(): Promise<string> {
  return requireActivePersonaId();
}

/** Register an active posting account. */
export async function createPostingAccount(data: {
  platform: string;
  handle: string;
}) {
  const supabase = await createClient();
  const personaId = await getPersonaId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (!data.handle.trim()) return { error: "Handle is required" };

  const { error } = await supabase.from("accounts").insert({
    persona_id: personaId,
    platform: data.platform,
    handle: data.handle.trim().replace(/^@/, ""),
    status: "graduated", // registry accounts are treated as active
    created_by: user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings/accounts");
  revalidatePath("/vault");
  return { error: null };
}

export async function deletePostingAccount(accountId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", accountId);
  if (error) return { error: error.message };
  revalidatePath("/settings/accounts");
  revalidatePath("/vault");
  return { error: null };
}
