import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Who may plan and auto-post for an account: the owners and managers of
 * its persona. Returns the account when the signed-in user may, else null.
 */
export async function plannerAccount(accountId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, persona_id, handle, platform, avatar_path, posts_per_day, telegram_chat_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return null;
  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", account.persona_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner" && membership?.role !== "manager") return null;
  return { account, userId: user.id };
}
