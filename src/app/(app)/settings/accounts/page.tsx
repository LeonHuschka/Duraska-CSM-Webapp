import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { AccountsManager } from "@/components/settings/accounts-manager";

export interface RegisteredAccount {
  id: string;
  platform: string;
  handle: string;
  status: string;
}

export default async function AccountsSettingsPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <p className="text-muted-foreground">Select a persona to manage accounts.</p>
    );
  }

  const { data } = await supabase
    .from("accounts")
    .select("id, platform, handle, status")
    .eq("persona_id", personaId)
    .order("platform", { ascending: true })
    .order("handle", { ascending: true });

  return <AccountsManager accounts={(data ?? []) as RegisteredAccount[]} />;
}
