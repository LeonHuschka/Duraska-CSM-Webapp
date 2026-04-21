import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { KanbanBoard } from "@/components/requests/kanban-board";
import type { ContentRequest, ContentType } from "@/lib/types/database";

export default async function RequestsPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">
          Select a persona to view content requests.
        </p>
      </div>
    );
  }

  const [requestsResult, typesResult] = await Promise.all([
    supabase
      .from("content_requests")
      .select("*")
      .eq("persona_id", personaId)
      .order("position", { ascending: true }),
    supabase
      .from("content_types")
      .select("*")
      .eq("persona_id", personaId)
      .order("position", { ascending: true }),
  ]);

  if (requestsResult.error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-destructive">
          Failed to load requests. Please try again.
        </p>
      </div>
    );
  }

  const requests = (requestsResult.data ?? []) as ContentRequest[];
  const contentTypes = (typesResult.data ?? []) as ContentType[];

  return <KanbanBoard requests={requests} contentTypes={contentTypes} personaId={personaId} />;
}
