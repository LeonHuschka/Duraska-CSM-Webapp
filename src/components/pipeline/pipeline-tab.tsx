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
export async function PipelineTab({
  personaId,
  canEdit = false,
}: {
  personaId: string;
  canEdit?: boolean;
}) {
  const supabase = await createClient();

  const [{ data: requests }, { data: links }, { data: accountRows }, { data: cfg }] =
    await Promise.all([
      supabase
        .from("content_requests")
        .select("id, title, status, created_at, shooted_at")
        .eq("persona_id", personaId),
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
        .select(
          "posts_per_day, slow_inspo_days, slow_edit_days, slow_post_days"
        )
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
  const postedTimes: number[] = [];
  for (const s of slots ?? []) {
    if (s.status !== "posted") continue;
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
  //
  // Stocks count everything; speed does not. The pre-July jobs ran under a
  // workflow with different steps and sat for months afterwards, so mixing
  // them in describes a process nobody follows any more. They stay in every
  // other figure on this page.
  const currentEra = new Set(
    reqs.filter((r) => /^Reel #/i.test(r.title)).map((r) => r.id)
  );
  const since = Date.now() - 30 * DAY;
  const editHours: number[] = [];
  const postHours: number[] = [];
  for (const r of reqs) {
    if (!currentEra.has(r.id)) continue;
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
    if (!currentEra.has(l.request_id)) continue;
    const raw = firstRaw.get(l.request_id);
    const asked = new Date(l.posted_at).getTime();
    if (raw !== undefined && raw >= since && raw > asked) {
      inspoHours.push((raw - asked) / HOUR);
    }
  }

  // End to end: from the moment the link was asked for to the moment the
  // reel went out. Measured on reels that actually completed the whole run,
  // not by adding the three medians up — those come from different reels
  // and their sum describes no reel that ever existed.
  const linkAskedAt = new Map<string, number>();
  for (const l of links ?? []) {
    if (!l.request_id || !l.posted_at) continue;
    const t = new Date(l.posted_at).getTime();
    const prev = linkAskedAt.get(l.request_id);
    if (prev === undefined || t < prev) linkAskedAt.set(l.request_id, t);
  }
  const endToEndHours: number[] = [];
  for (const r of reqs) {
    if (!currentEra.has(r.id)) continue;
    const out = firstPosted.get(r.id);
    const start = linkAskedAt.get(r.id) ?? firstRaw.get(r.id);
    if (out !== undefined && start !== undefined && out > start) {
      endToEndHours.push((out - start) / HOUR);
    }
  }
  const endToEndDays =
    median(endToEndHours) !== null ? median(endToEndHours)! / 24 : null;

  const legs = [
    {
      key: "inspo",
      label: "Inspo → uploaded",
      days: median(inspoHours) !== null ? median(inspoHours)! / 24 : null,
      slowDays: Number(cfg?.slow_inspo_days ?? 14),
      hint: "link out to her takes in",
    },
    {
      key: "edit",
      label: "Uploaded → cut",
      days: median(editHours) !== null ? median(editHours)! / 24 : null,
      slowDays: Number(cfg?.slow_edit_days ?? 7),
      hint: "takes waiting for the editor",
    },
    {
      key: "post",
      label: "Cut → posted",
      days: median(postHours) !== null ? median(postHours)! / 24 : null,
      slowDays: Number(cfg?.slow_post_days ?? 7),
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
      <StageGauges
        legs={legs}
        endToEndDays={endToEndDays}
        endToEndCount={endToEndHours.length}
        editable={canEdit}
      />
      <StageFunnel stages={stages} />
      <ThroughputChart weeks={weeks} />
      <OldestWaiting items={oldest} />
    </div>
  );
}
