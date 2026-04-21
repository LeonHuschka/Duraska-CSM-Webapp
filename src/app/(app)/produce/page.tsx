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

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [requestsResult, typesResult, shotLastWeekResult] = await Promise.all([
    supabase
      .from("content_requests")
      .select("*")
      .eq("persona_id", personaId)
      .eq("status", "requested")
      .order("created_at", { ascending: false }),
    supabase
      .from("content_types")
      .select("*")
      .eq("persona_id", personaId)
      .order("position", { ascending: true }),
    supabase
      .from("content_requests")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .eq("status", "shooted")
      .gte("updated_at", oneWeekAgo.toISOString()),
  ]);

  const requests = (requestsResult.data ?? []) as ContentRequest[];
  const contentTypes = (typesResult.data ?? []) as ContentType[];
  const shotLastWeek = shotLastWeekResult.count ?? 0;
  const openCount = requests.filter((r) => r.status === "requested").length;

  return (
    <ProduceView
      requests={requests}
      contentTypes={contentTypes}
      openCount={openCount}
      shotLastWeek={shotLastWeek}
    />
  );
}
