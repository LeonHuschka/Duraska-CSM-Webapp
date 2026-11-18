import { getActivePersonaId } from "@/lib/persona";
import { createClient } from "@/lib/supabase/server";
import { listTrials } from "@/lib/trials";
import { TrialHub } from "@/components/trials/trial-hub";

/** The winner hub: every Trial-Maxxing of the persona, sorted by what needs doing. */
export const dynamic = "force-dynamic";

export default async function TrialsPage() {
  const personaId = await getActivePersonaId();
  if (!personaId) return <p className="text-sm text-muted-foreground">Select a persona first.</p>;
  const supabase = await createClient();
  const all = await listTrials(supabase, personaId, true);
  return <TrialHub trials={all} />;
}
