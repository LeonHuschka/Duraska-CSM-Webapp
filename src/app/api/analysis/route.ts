import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database";
import { geminiConfigured, GEMINI_MODEL } from "@/lib/gemini";
import { selectCohorts, syncCohorts } from "@/lib/analysis/cohorts";
import { claimRows, openCount, watchReel } from "@/lib/analysis/watch";
import { buildStats, winnerSummaries, writeBriefing, type AnalysisStats } from "@/lib/analysis/report";

/**
 * Analysis, in steps that each fit one invocation:
 *
 *   ?persona=<id>            start: pick the cohorts, queue the new reels
 *   &step=work&run=<id>      watch BATCH reels, then hand on to the next
 *                            invocation until none is left
 *   &step=finish&run=<id>    count, write the briefing, close the run
 *   ?all=1                   start every persona (the Sunday cron)
 *
 * Signed in as an owner, or with the cron secret. Steps after the first
 * call themselves with the secret, so without CRON_SECRET a run stops after
 * one batch.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 4;
/** One reel may take this long; the batch has to finish well inside maxDuration. */
const REEL_DEADLINE_MS = 200_000;
/** A running run whose last batch is older than this has lost its chain. */
const STALL_MS = 6 * 60_000;

async function allowed(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = req.headers.get("x-link-check-secret") ?? url.searchParams.get("secret");
  if (secret && given === secret) return true;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle();
  return profile?.global_role === "owner";
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

/** The next step, in an invocation of its own. */
async function next(origin: string, params: Record<string, string>) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const u = new URL("/api/analysis", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  await fetch(u, { method: "POST", headers: { "x-link-check-secret": secret } }).catch((err) =>
    console.error("[analysis] next step not started", err)
  );
}

async function handle(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const supabase = createAdminClient();
  const step = url.searchParams.get("step") ?? "start";
  const runId = url.searchParams.get("run");

  if (url.searchParams.get("all") === "1") {
    const { data: personas } = await supabase.from("personas").select("id");
    waitUntil(Promise.all((personas ?? []).map((p) => next(url.origin, { persona: p.id }))).then(() => undefined));
    return NextResponse.json({ ok: true, personas: personas?.length ?? 0 }, { status: 202 });
  }

  if (step === "start") {
    const personaId = url.searchParams.get("persona");
    if (!personaId) return NextResponse.json({ error: "persona missing" }, { status: 400 });
    const { data: running } = await supabase
      .from("analysis_runs")
      .select("id, started_at, counts")
      .eq("persona_id", personaId)
      .eq("status", "running")
      .gte("started_at", new Date(Date.now() - 3 * 3600_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (running) {
      // An invocation that died takes the chain with it: pick the run up again.
      const beat = Number((running.counts as Record<string, number> | null)?.beat ?? new Date(running.started_at).getTime());
      if (Date.now() - beat < STALL_MS) return NextResponse.json({ ok: true, already: running.id });
      await supabase.from("reel_analyses").update({ status: "pending" }).eq("persona_id", personaId).eq("status", "working");
      waitUntil(next(url.origin, { step: "work", run: running.id, persona: personaId }));
      return NextResponse.json({ ok: true, resumed: running.id }, { status: 202 });
    }

    const cohorts = await selectCohorts(supabase, personaId);
    const sync = await syncCohorts(supabase, personaId, cohorts);
    const counts = {
      winners: cohorts.filter((c) => c.cohort === "winner").length,
      losers: cohorts.filter((c) => c.cohort === "loser").length,
      controls: cohorts.filter((c) => c.cohort === "control").length,
      added: sync.added,
      again: sync.again,
      usd: 0,
    };
    const configured = geminiConfigured();
    const { data: run } = await supabase
      .from("analysis_runs")
      .insert({
        persona_id: personaId,
        counts: counts as unknown as Json,
        model: GEMINI_MODEL,
        note: configured ? null : "GEMINI_API_KEY not set — reels are queued, not watched",
      })
      .select("id")
      .single();
    if (!run) return NextResponse.json({ error: "run not created" }, { status: 500 });
    // Without a key nothing can be watched; what was watched before is still counted.
    waitUntil(next(url.origin, { step: configured ? "work" : "finish", run: run.id, persona: personaId }));
    return NextResponse.json({ ok: true, run: run.id, counts }, { status: 202 });
  }

  const personaId = url.searchParams.get("persona");
  if (!runId || !personaId) return NextResponse.json({ error: "run or persona missing" }, { status: 400 });

  if (step === "work") {
    waitUntil(
      (async () => {
        const { data: current } = await supabase.from("analysis_runs").select("status").eq("id", runId).maybeSingle();
        if (current?.status !== "running") return; // stopped or finished meanwhile
        let left = 0;
        try {
          const rows = await claimRows(supabase, personaId, BATCH);
          // A hung download or Apify run must not take the whole invocation down with it.
          const results = await Promise.all(
            rows.map((r) =>
              Promise.race([
                watchReel(supabase, r),
                new Promise<{ ok: boolean; note: string; usd: number }>((resolve) =>
                  setTimeout(async () => {
                    await supabase.from("reel_analyses").update({ status: "failed", note: "timed out" }).eq("id", r.id);
                    resolve({ ok: false, note: "timed out", usd: 0 });
                  }, REEL_DEADLINE_MS)
                ),
              ])
            )
          );
          const usd = results.reduce((s, r) => s + r.usd, 0);
          const { data: run } = await supabase.from("analysis_runs").select("counts").eq("id", runId).maybeSingle();
          const counts = (run?.counts ?? {}) as Record<string, number>;
          await supabase
            .from("analysis_runs")
            .update({
              counts: {
                ...counts,
                usd: (counts.usd ?? 0) + usd,
                watched: (counts.watched ?? 0) + results.filter((r) => r.ok).length,
                failed: (counts.failed ?? 0) + results.filter((r) => !r.ok).length,
                beat: Date.now(),
              } as unknown as Json,
            })
            .eq("id", runId);
          results.forEach((r, i) => {
            if (!r.ok) console.warn("[analysis]", rows[i].shortcode, r.note);
          });
          left = rows.length ? await openCount(supabase, personaId) : 0;
        } catch (err) {
          console.error("[analysis] batch failed", err);
          left = await openCount(supabase, personaId);
        }
        await next(url.origin, { step: left > 0 ? "work" : "finish", run: runId, persona: personaId });
      })()
    );
    return NextResponse.json({ ok: true, step }, { status: 202 });
  }

  // The counting is quick and saved first, so the page has it even if the
  // briefing fails; the briefing gets an invocation of its own.
  if (step === "finish") {
    waitUntil(
      (async () => {
        try {
          const cohorts = await selectCohorts(supabase, personaId);
          const stats = await buildStats(supabase, personaId, cohorts);
          await supabase
            .from("analysis_runs")
            .update({ status: "done", stats: stats as unknown as Json, finished_at: new Date().toISOString() })
            .eq("id", runId);
          if (stats.all.winners > 0) await next(url.origin, { step: "brief", run: runId, persona: personaId });
        } catch (err) {
          await supabase
            .from("analysis_runs")
            .update({ status: "failed", note: err instanceof Error ? err.message.slice(0, 300) : "failed", finished_at: new Date().toISOString() })
            .eq("id", runId);
        }
      })()
    );
    return NextResponse.json({ ok: true, step }, { status: 202 });
  }

  if (step === "brief") {
    waitUntil(
      (async () => {
        const { data: run } = await supabase.from("analysis_runs").select("stats").eq("id", runId).maybeSingle();
        const stats = run?.stats as unknown as AnalysisStats | null;
        if (!stats) return;
        try {
          const winnerIds = stats.reels.filter((r) => r.cohort === "winner").map((r) => r.id);
          const briefing = await writeBriefing(stats, await winnerSummaries(supabase, winnerIds));
          await supabase.from("analysis_runs").update({ briefing: briefing as unknown as Json }).eq("id", runId);
        } catch (err) {
          const why = err instanceof Error ? err.message.slice(0, 200) : "failed";
          await supabase.from("analysis_runs").update({ note: `Briefing not written: ${why}` }).eq("id", runId);
        }
      })()
    );
    return NextResponse.json({ ok: true, step }, { status: 202 });
  }

  return NextResponse.json({ error: "unknown step" }, { status: 400 });
}
