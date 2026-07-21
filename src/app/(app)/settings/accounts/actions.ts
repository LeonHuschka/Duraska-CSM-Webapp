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
