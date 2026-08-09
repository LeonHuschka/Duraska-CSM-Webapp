import { createClient } from "@/lib/supabase/server";
import {
  StageFunnel,
  ThroughputChart,
  OldestWaiting,
  AccountsPie,
  PostedCard,
  StageGauges,
} from "@/components/pipeline/pipeline-view";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Median, because one reel forgotten for a month would drag a mean useless. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The Pipeline tab of the manager dashboard. */
export async function PipelineTab({ personaId }: { personaId: string }) {
  const supabase = await createClient();

  const [{ data: requests }, { data: links }, { data: accountRows }, { data: cfg }] =
    await Promise.all([
      supabase
        .from("content_requests")
        .select("id, title, status, created_at, shooted_at")
        .eq("persona_id", personaId)
        // Only the current era. Everything before the July rebuild is named
        // Boyfriend / Roleplay / Speaking and belongs to a workflow that no
        // longer exists; counting it makes every figure look healthier than
        // the operation actually is.
        .ilike("title", "Reel #%"),
      supabase
        .from("content_links")
        .select("status, posted_at, request_id")
        .eq("persona_id", personaId),
      supabase
        .from("accounts")
        .select("id, platform")
        .eq("persona_id", personaId)
        .not("status", "in", '("dead","paused")'),
      supabase
        .from("telegram_config")
        .select("posts_per_day")
        .eq("persona_id", personaId)
        .maybeSingle(),
    ]);

  const reqs = requests ?? [];
  // Assets carry no persona of their own — they belong to one through their
  // request, so they are fetched by the ids we just resolved.
  const requestIds = reqs.map((r) => r.id);
  const [{ data: assets }, { data: slots }] = await Promise.all([
    requestIds.length
      ? supabase
          .from("content_assets")
          .select("id, request_id, stage, uploaded_at")
          .in("request_id", requestIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("schedule_slots")
      .select("request_id, asset_id, status, posted_at, scheduled_for")
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
  //
  // Counted in cuts, not jobs. A job yields several final cuts and each is
  // its own reel that goes out once, so "ready" has to mean the cuts nobody
  // has posted — which is also the number the model's buffer uses.
  const editedCuts = (assets ?? []).filter((a) => a.stage === "edited");
  const postedCutIds = new Set<string>();
  const postedRequestsLegacy = new Set<string>();
  for (const s of slots ?? []) {
    if (s.status !== "posted") continue;
    if (s.asset_id) postedCutIds.add(s.asset_id);
    else if (s.request_id) postedRequestsLegacy.add(s.request_id);
  }
  const isPosted = (a: { id: string; request_id: string | null }) =>
    postedCutIds.has(a.id) ||
    (a.request_id ? postedRequestsLegacy.has(a.request_id) : false);

  const availableCuts = editedCuts.filter((a) => !isPosted(a)).length;
  const postedCuts = editedCuts.filter((a) => isPosted(a)).length;

  const openLinks = (links ?? []).filter((l) => l.status === "open").length;
  const toEdit = reqs.filter((r) => r.status === "shooted").length;

  // Posted is deliberately absent: it only ever grows, so in a proportional
  // bar it swallows the three figures that actually move.
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
      note: "jobs waiting for a cut",
    },
    {
      label: "Ready",
      value: availableCuts,
      tone: "bg-emerald-400",
      note: "cuts nobody has posted",
    },
  ];

  // ── Posted, and whether the pace is picking up ──
  // Same population as the total above it. Counting every slot here while
  // the total counts only current-era cuts put "0 posted" and "30 in the
  // last 7 days" on screen together.
  const currentRequestIds = new Set(requestIds);
  const postedTimes: number[] = [];
  for (const s of slots ?? []) {
    if (s.status !== "posted") continue;
    if (!s.request_id || !currentRequestIds.has(s.request_id)) continue;
    const when = s.posted_at ?? s.scheduled_for;
    if (when) postedTimes.push(new Date(when).getTime());
  }
  const last7 = postedTimes.filter((t) => t >= Date.now() - 7 * DAY).length;
  const previous7 = postedTimes.filter(
    (t) => t >= Date.now() - 14 * DAY && t < Date.now() - 7 * DAY
  ).length;

  const platformOrder = ["instagram", "facebook", "tiktok", "x"];
  const platformCounts = platformOrder
    .map((p) => ({
      platform: p,
      count: (accountRows ?? []).filter((a) => a.platform === p).length,
    }))
    .filter((p) => p.count > 0);

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

  // Inspo link posted → her first take uploaded. The leg that is entirely
  // the model's, and the only one the other two can't be blamed for.
  const inspoHours: number[] = [];
  for (const l of links ?? []) {
    if (!l.request_id || !l.posted_at) continue;
    const raw = firstRaw.get(l.request_id);
    const asked = new Date(l.posted_at).getTime();
    if (raw !== undefined && raw >= since && raw > asked) {
      inspoHours.push((raw - asked) / HOUR);
    }
  }

  const legs = [
    {
      label: "Inspo → uploaded",
      days: median(inspoHours) !== null ? median(inspoHours)! / 24 : null,
      target: 3,
      hint: "link out to her takes in",
    },
    {
      label: "Uploaded → cut",
      days: median(editHours) !== null ? median(editHours)! / 24 : null,
      target: 2,
      hint: "takes waiting for the editor",
    },
    {
      label: "Cut → posted",
      days: median(postHours) !== null ? median(postHours)! / 24 : null,
      target: 2,
      hint: "finished reels waiting to go out",
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
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <AccountsPie
          counts={platformCounts}
          postsPerDay={cfg?.posts_per_day ?? 2}
        />
        <PostedCard total={postedCuts} last7={last7} previous7={previous7} />
      </div>
      <StageGauges legs={legs} />
      <StageFunnel stages={stages} />
      <ThroughputChart weeks={weeks} />
      <OldestWaiting items={oldest} />
    </div>
  );
}
