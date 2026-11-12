import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DIMENSIONS, loadTrial, roundBrief, winnersOf, type Dimension } from "@/lib/trials";
import { TrialMatrix } from "@/components/trials/trial-matrix";
import { TrialStatus } from "@/components/trials/trial-status";
import { accountLabel } from "@/lib/account-analytics";

/**
 * One trial: the outlier on top, the three rounds under it. The model
 * comes here from her dashboard or the Telegram button and fills the
 * boxes; staff name the variations, read the plays and decide each round.
 */
export const dynamic = "force-dynamic";

export default async function TrialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ decide?: string; view?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
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
  // A manager may look at the page as the model sees it.
  const preview = staff && sp.view === "model";
  const w = winnersOf(t);

  // Why it is not simply running, and for a proposal: what it would replace.
  const { data: row } = await supabase.from("trials").select("status_note, replaces_trial_id").eq("id", t.id).maybeSingle();
  let replaces: { id: string; label: string; views: number | null } | null = null;
  if (row?.replaces_trial_id) {
    const { data: old } = await supabase
      .from("trials")
      .select("id, shortcode, views, accounts(handle)")
      .eq("id", row.replaces_trial_id)
      .maybeSingle();
    if (old) {
      const handle = (old as unknown as { accounts: { handle: string } | null }).accounts?.handle;
      replaces = { id: old.id, label: handle ? `${accountLabel(handle)} · ${old.shortcode}` : old.shortcode, views: old.views };
    }
  }
  // Each round as big as it is — rounds need not be the same size.
  const briefs = Object.fromEntries(
    DIMENSIONS.map((d) => [d, roundBrief(d, w, t.cells.filter((c) => c.dimension === d).length)])
  ) as Record<Dimension, string>;
  const { data: persona } = await supabase.from("personas").select("trial_reshoots").eq("id", t.personaId).maybeSingle();

  return (
    <div className="space-y-4">
    <TrialStatus
      trialId={t.id}
      status={t.status}
      note={row?.status_note ?? null}
      replaces={replaces}
      staff={staff && !preview}
      decide={sp.decide === "keep" ? "keep" : sp.decide === "replace" ? "replace" : null}
    />
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
        reshoots: persona?.trial_reshoots ?? t.reshoots,
        // The team's notes stay off the model's page.
        cells: staff && !preview ? t.cells : t.cells.map((c) => ({ ...c, notes: null })),
        briefs,
      }}
      staff={staff && !preview}
      preview={preview}
      backHref={preview ? "/?view=model" : staff ? "/?tab=accounts" : "/"}
    />
    </div>
  );
}
