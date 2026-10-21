import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DIMENSIONS, loadTrial, roundBrief, winnersOf, type Dimension } from "@/lib/trials";
import { TrialMatrix } from "@/components/trials/trial-matrix";

/**
 * One trial: the outlier on top, the three rounds under it. The model
 * comes here from her dashboard or the Telegram button and fills the
 * boxes; staff name the variations, read the plays and decide each round.
 */
export const dynamic = "force-dynamic";

export default async function TrialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = await loadTrial(supabase, id);
  if (!t) notFound();

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", t.personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const staff = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  const w = winnersOf(t);
  const briefs = Object.fromEntries(DIMENSIONS.map((d) => [d, roundBrief(d, w)])) as Record<Dimension, string>;

  return (
    <TrialMatrix
      trial={{
        id: t.id,
        personaId: t.personaId,
        account: t.account,
        postUrl: t.postUrl,
        caption: t.caption,
        cover: t.cover,
        video: t.video,
        views: t.views,
        lift: t.lift,
        sourceTitle: t.sourceTitle,
        phase: t.phase,
        status: t.status,
        cells: t.cells,
        briefs,
      }}
      staff={staff}
      backHref={staff ? "/?tab=accounts" : "/"}
    />
  );
}
