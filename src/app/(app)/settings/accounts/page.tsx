import { getActivePersonaId } from "@/lib/persona";
import { createClient } from "@/lib/supabase/server";
import { AccountsManager } from "@/components/settings/accounts-manager";

export interface RegisteredAccount {
  id: string;
  platform: string;
  handle: string;
  status: string;
  telegram_chat_id: number | null;
  telegram_thread_id: number | null;
}

export default async function AccountsSettingsPage() {
  const supabase = await createClient();
  const personaId = await getActivePersonaId();

  if (!personaId) {
    return (
      <p className="text-muted-foreground">Select a persona to manage accounts.</p>
    );
  }

  const { data } = await supabase
    .from("accounts")
    .select("id, platform, handle, status, telegram_chat_id, telegram_thread_id")
    .eq("persona_id", personaId)
    .order("platform", { ascending: true })
    .order("handle", { ascending: true });

  return <AccountsManager accounts={(data ?? []) as RegisteredAccount[]} />;
}
