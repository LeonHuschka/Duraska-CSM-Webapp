import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { ProduceView } from "@/components/produce/produce-view";
import type { ContentRequest, ContentType } from "@/lib/types/database";

export default async function ProducePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">
          Select a persona to view your requests.
        </p>
      </div>
    );
  }

  // Get user role
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", personaId)
    .eq("user_id", user?.id ?? "")
    .single();

  const role = (membership?.role ?? "va") as string;
  const isModel = role === "model";

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Models only see "requested", others see requested + shooted + edited
  const statusFilter = isModel
    ? ["requested"]
    : ["requested", "shooted", "edited"];

  const [requestsResult, typesResult, shotLastWeekResult, advanceResult, readyResult, timeslotsResult] = await Promise.all([
    supabase
      .from("content_requests")
      .select("*")
      .eq("persona_id", personaId)
      .in("status", statusFilter)
      .order("created_at", { ascending: false }),
    supabase
      .from("content_types")
      .select("*")
      .eq("persona_id", personaId)
      .order("position", { ascending: true }),
    // Count requests shot this week.
    // Primary signal: shooted_at >= 7 days ago (set when status moves to "shooted").
    // Fallback: shooted_at IS NULL but created_at is within this week and status is
    //   beyond "requested" — catches any historical records still missing shooted_at.
    supabase
      .from("content_requests")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .or(
        `shooted_at.gte.${oneWeekAgo.toISOString()},and(shooted_at.is.null,created_at.gte.${oneWeekAgo.toISOString()},status.neq.requested)`
      ),
    // Model stat: shooted + edited + scheduled = full advance pool
    supabase
      .from("content_requests")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .in("status", ["shooted", "edited", "scheduled"]),
    // VA stat: edited + scheduled = finished content ready to post
    supabase
      .from("content_requests")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .in("status", ["edited", "scheduled"]),
    // Timeslots per day to calculate days of advance content
    supabase
      .from("posting_timeslots")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId),
  ]);

  const requests = (requestsResult.data ?? []) as ContentRequest[];
  const contentTypes = (typesResult.data ?? []) as ContentType[];
  const shotLastWeek = shotLastWeekResult.count ?? 0;
  const openCount = requests.filter((r) => r.status === "requested").length;
  const advanceCount = advanceResult.count ?? 0;
  const readyCount = readyResult.count ?? 0;
  const timeslotsPerDay = Math.max(timeslotsResult.count ?? 1, 1);
  const daysOfContent = Math.floor(readyCount / timeslotsPerDay);
  const weeklyTarget = timeslotsPerDay * 7;

  return (
    <ProduceView
      requests={requests}
      contentTypes={contentTypes}
      openCount={openCount}
      shotLastWeek={shotLastWeek}
      isModel={isModel}
      advanceCount={advanceCount}
      daysOfContent={daysOfContent}
      weeklyTarget={weeklyTarget}
    />
  );
}
