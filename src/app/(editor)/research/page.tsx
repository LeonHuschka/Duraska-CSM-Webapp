import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActivePersonaId } from "@/lib/persona";
import { AnalysisView } from "@/components/research/analysis-view";
import { RunAnalysisButton } from "@/components/research/run-analysis-button";
import type { AnalysisBriefing, AnalysisStats } from "@/lib/analysis/report";

/**
 * Research & Pattern, apart from the dashboard. Analysis explains the
 * persona's own winners; Research (next) goes looking for reels to copy,
 * guided by what Analysis found. Opens in its own tab from the Accounts tab.
 */
export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function ResearchPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; scope?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const tab = sp.tab === "research" ? "research" : "analysis";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const personaId = await getActivePersonaId();
  if (!personaId) return <p className="p-6 text-sm text-muted-foreground">Select a persona first.</p>;

  const [{ data: profile }, { data: persona }, { data: lastRun }, { data: doneRun }, { data: queue }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("personas").select("name, brand_color").eq("id", personaId).maybeSingle(),
    supabase
      .from("analysis_runs")
      .select("id, status, note, counts, started_at, finished_at")
      .eq("persona_id", personaId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("analysis_runs")
      .select("stats, briefing, finished_at")
      .eq("persona_id", personaId)
      .eq("status", "done")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("reel_analyses").select("status, cohort, note").eq("persona_id", personaId),
  ]);
  const isOwner = profile?.global_role === "owner";
  // A run older than three hours that never finished died on the way.
  const counts = (lastRun?.counts ?? {}) as Record<string, number>;
  const open = lastRun?.status === "running" && Date.now() - new Date(lastRun.started_at).getTime() < 3 * 3600_000;
  // No batch for six minutes: the chain broke; Run picks it up again.
  const stalled = open && Date.now() - Number(counts.beat ?? new Date(lastRun.started_at).getTime()) > 6 * 60_000;
  const running = open && !stalled;
  const watched = (queue ?? []).filter((q) => q.status === "done").length;
  const failed = (queue ?? []).filter((q) => q.status === "failed");
  const lastFailure = failed.find((f) => f.note)?.note;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/?tab=accounts" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: persona?.brand_color ?? "#8b5cf6" }} />
            <h1 className="text-2xl font-semibold tracking-tight">Research &amp; Pattern</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{persona?.name} · why winners win, and what to shoot next</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-border/50 bg-card p-1">
        {(
          [
            { key: "analysis", label: "Analysis" },
            { key: "research", label: "Research" },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={t.key === "analysis" ? "/research" : "/research?tab=research"}
            scroll={false}
            className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors ${
              tab === t.key ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "analysis" ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {lastRun ? (
                <>
                  <span className="text-foreground">
                    {running ? "Running" : stalled ? "Stalled — run again to resume" : lastRun.status === "failed" ? "Last run failed" : "Last run"}
                  </span>{" "}
                  · {when(lastRun.started_at)}
                  {counts.winners != null && (
                    <>
                      {" "}
                      · {counts.winners} winners · {counts.losers} losers · {counts.controls} control
                    </>
                  )}
                  {" "}· {watched} reels watched{failed.length ? ` · ${failed.length} failed` : ""}
                  {counts.usd ? ` · ~$${counts.usd.toFixed(2)} this run` : ""}
                  {lastRun.note && <span className="ml-1 text-amber-400">· {lastRun.note}</span>}
                  {!lastRun.note && lastFailure && <span className="ml-1 text-rose-400">· last failure: {lastFailure}</span>}
                </>
              ) : (
                "Never run. The first run watches every winner, clean loser and a control sample once; after that only new reels."
              )}
            </div>
            {isOwner && <RunAnalysisButton personaId={personaId} running={running} />}
          </div>

          <AnalysisView
            stats={(doneRun?.stats ?? null) as unknown as AnalysisStats | null}
            briefing={(doneRun?.briefing ?? null) as unknown as AnalysisBriefing | null}
            scope={sp.scope ?? "all"}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
          <p className="text-sm font-medium">Research comes next</p>
          <p className="mx-auto mt-2 max-w-lg text-xs text-muted-foreground">
            Reels from competitors and the market (DE / US) that match this persona&apos;s winning patterns or ride a
            current trend — each with a reason, a Request button for the requests topic and Bad as feedback. It builds on
            the patterns Analysis finds here.
          </p>
        </div>
      )}
    </div>
  );
}
