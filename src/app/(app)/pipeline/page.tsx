import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePersonaId } from "@/lib/persona";
import {
  StageFunnel,
  ThroughputChart,
  StageDurations,
  OldestWaiting,
} from "@/components/pipeline/pipeline-view";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Median, because one reel forgotten for a month would drag a mean useless. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function PipelinePage() {
  const supabase = await createClient();
  const personaId = await getActivePersonaId();
  if (!personaId) redirect("/settings/personas");

  // Only staff should see throughput and who is holding things up.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", personaId)
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  if (membership?.role === "model") redirect("/");

  const [{ data: requests }, { data: links }] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, title, status, created_at, shooted_at")
      .eq("persona_id", personaId),
    supabase.from("content_links").select("status").eq("persona_id", personaId),
  ]);

  const reqs = requests ?? [];
  // Assets carry no persona of their own — they belong to one through their
  // request, so they are fetched by the ids we just resolved.
  const requestIds = reqs.map((r) => r.id);
  const [{ data: assets }, { data: slots }] = await Promise.all([
    requestIds.length
      ? supabase
          .from("content_assets")
          .select("request_id, stage, uploaded_at")
          .in("request_id", requestIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("schedule_slots")
      .select("request_id, status, posted_at, scheduled_for")
      .eq("persona_id", personaId)
      .eq("status", "posted"),
  ]);

  // First raw take and first finished cut per request — the two events that
  // bracket the editor's part of the job.
  const firstRaw = new Map<string, number>();
  const firstEdited = new Map<string, number>();
  for (const a of assets ?? []) {
    if (!a.request_id || !a.uploaded_at) continue;
    const t = new Date(a.uploaded_at).getTime();
    const target = a.stage === "edited" ? firstEdited : firstRaw;
    if (a.stage !== "edited" && a.stage !== "raw") continue;
    const prev = target.get(a.request_id);
    if (prev === undefined || t < prev) target.set(a.request_id, t);
  }
  const firstPosted = new Map<string, number>();
  for (const s of slots ?? []) {
    // posted_at is set when the VA marks it; scheduled_for is the fallback
    // for rows that predate that button.
    const when = s.posted_at ?? s.scheduled_for;
    if (!s.request_id || !when) continue;
    const t = new Date(when).getTime();
    const prev = firstPosted.get(s.request_id);
    if (prev === undefined || t < prev) firstPosted.set(s.request_id, t);
  }

  // ── Where the work sits ──
  const openLinks = (links ?? []).filter((l) => l.status === "open").length;
  const toEdit = reqs.filter((r) => r.status === "shooted").length;
  const ready = reqs.filter((r) => r.status === "edited").length;
  const posted = reqs.filter((r) => r.status === "posted").length;

  const stages = [
    {
      label: "Open inspo",
      value: openLinks,
      tone: "bg-amber-400",
      note: "links waiting to be shot",
    },
    {
      label: "To edit",
      value: toEdit,
      tone: "bg-purple-400",
      note: "takes waiting for a cut",
    },
    {
      label: "Ready",
      value: ready,
      tone: "bg-emerald-400",
      note: "cut, not posted yet",
    },
    {
      label: "Posted",
      value: posted,
      tone: "bg-blue-400",
      note: "done and out",
    },
  ];

  // ── Throughput, last 8 weeks (Mon–Sun) ──
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() - (7 - i) * 7 + 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const from = start.getTime();
    const to = end.getTime();
    const within = (t: number | undefined) =>
      t !== undefined && t >= from && t < to;

    return {
      label: `${start.getDate()}.${start.getMonth() + 1}`,
      shot: reqs.filter((r) =>
        within(r.shooted_at ? new Date(r.shooted_at).getTime() : undefined)
      ).length,
      edited: reqs.filter((r) => within(firstEdited.get(r.id))).length,
      posted: reqs.filter((r) => within(firstPosted.get(r.id))).length,
    };
  });

  // ── Time per stage, last 30 days ──
  const since = Date.now() - 30 * DAY;
  const editHours: number[] = [];
  const postHours: number[] = [];
  for (const r of reqs) {
    const raw = firstRaw.get(r.id);
    const cut = firstEdited.get(r.id);
    const out = firstPosted.get(r.id);
    if (raw !== undefined && cut !== undefined && cut >= since && cut > raw) {
      editHours.push((cut - raw) / HOUR);
    }
    if (cut !== undefined && out !== undefined && out >= since && out > cut) {
      postHours.push((out - cut) / HOUR);
    }
  }

  const durations = [
    {
      label: "Upload → cut",
      median: median(editHours),
      slowest: editHours.length ? Math.max(...editHours) : null,
      hint: "how long takes wait for the editor",
    },
    {
      label: "Cut → posted",
      median: median(postHours),
      slowest: postHours.length ? Math.max(...postHours) : null,
      hint: "how long finished reels sit before going out",
    },
  ];

  // ── The specific items that have waited longest ──
  const oldest = reqs
    .filter((r) => r.status === "shooted" || r.status === "edited")
    .map((r) => {
      const waitingSince =
        r.status === "shooted"
          ? (firstRaw.get(r.id) ??
            (r.shooted_at ? new Date(r.shooted_at).getTime() : null))
          : (firstEdited.get(r.id) ?? null);
      return {
        id: r.id,
        title: r.title,
        stage: r.status === "shooted" ? "waiting for cut" : "waiting to post",
        days:
          waitingSince === null
            ? 0
            : Math.floor((Date.now() - waitingSince) / DAY),
      };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where content is, how fast it moves, and what is stuck
        </p>
      </div>

      <StageFunnel stages={stages} />
      <ThroughputChart weeks={weeks} />
      <StageDurations durations={durations} />
      <OldestWaiting items={oldest} />
    </div>
  );
}
