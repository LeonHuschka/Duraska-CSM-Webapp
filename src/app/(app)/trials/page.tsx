import { getActivePersonaId } from "@/lib/persona";
import { createClient } from "@/lib/supabase/server";
import { listTrials } from "@/lib/trials";
import { TrialJobs } from "@/components/dashboard/model-home";

/** Every Trial-Maxxing of the persona: running ones first, finished ones after. */
export const dynamic = "force-dynamic";

export default async function TrialsPage() {
  const personaId = await getActivePersonaId();
  if (!personaId) return <p className="text-sm text-muted-foreground">Select a persona first.</p>;
  const supabase = await createClient();
  const all = await listTrials(supabase, personaId, true);
  const running = all.filter((t) => t.phase !== "done");
  const done = all.filter((t) => t.phase === "done");
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trial-Maxxing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outliers reshot in three rounds — outfits, locations, hooks — until the account&apos;s pattern shows.
          Start one from a reel on the Accounts tab.
        </p>
      </div>
      <TrialJobs trials={running} />
      {done.length > 0 && (
        <div className="space-y-3">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">Patterns found</h2>
          <TrialJobs trials={done} />
        </div>
      )}
    </div>
  );
}
