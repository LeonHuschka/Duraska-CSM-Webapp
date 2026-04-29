import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { ScheduleView } from "@/components/schedule/schedule-view";

export default async function SchedulePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground">
          Select a persona to view the schedule.
        </p>
      </div>
    );
  }

  const [slotsResult, requestsResult, timeslotsResult, editedRequestsResult] =
    await Promise.all([
      supabase
        .from("schedule_slots")
        .select("*")
        .eq("persona_id", personaId)
        .order("scheduled_for", { ascending: true }),
      supabase
        .from("content_requests")
        .select("id, title, status")
        .eq("persona_id", personaId)
        .order("title", { ascending: true }),
      supabase
        .from("posting_timeslots")
        .select("*")
        .eq("persona_id", personaId)
        .order("position", { ascending: true }),
      supabase
        .from("content_requests")
        .select("id, title, status, priority, content_type_id, is_nsfw")
        .eq("persona_id", personaId)
        .eq("status", "edited")
        .order("updated_at", { ascending: false }),
    ]);

  const slots = slotsResult.data ?? [];
  const requests = requestsResult.data ?? [];
  const timeslots = timeslotsResult.data ?? [];
  const editedRequests = editedRequestsResult.data ?? [];

  // Auto-promote: "scheduled" slots whose time has passed → "posted"
  const now = new Date();
  const pastScheduledSlots = slots.filter(
    (s) => s.status === "scheduled" && new Date(s.scheduled_for) < now
  );
  if (pastScheduledSlots.length > 0) {
    await Promise.all(
      pastScheduledSlots.map(async (slot) => {
        await supabase
          .from("schedule_slots")
          .update({ status: "posted", posted_at: now.toISOString() })
          .eq("id", slot.id);
        // Also mark linked content request as posted
        if (slot.request_id) {
          await supabase
            .from("content_requests")
            .update({ status: "posted", updated_at: now.toISOString() })
            .eq("id", slot.request_id);
        }
        // Update local data so UI reflects it immediately
        slot.status = "posted";
        slot.posted_at = now.toISOString();
      })
    );
  }

  // Fetch assets for slots that have linked requests
  const requestIds = Array.from(
    new Set(slots.map((s) => s.request_id).filter(Boolean) as string[])
  );

  let assetsWithUrls: Array<{
    id: string;
    request_id: string;
    stage: string;
    file_name: string;
    mime_type: string | null;
    signedUrl: string;
  }> = [];

  if (requestIds.length > 0) {
    const { data: assets } = await supabase
      .from("content_assets")
      .select("id, request_id, stage, file_path, file_name, mime_type")
      .in("request_id", requestIds)
      .in("stage", ["edited", "final"])
      .is("deleted_at", null);

    if (assets && assets.length > 0) {
      const urlResults = await Promise.all(
        assets.map(async (asset) => {
          const { data } = await supabase.storage
            .from("content-assets")
            .createSignedUrl(asset.file_path, 3600);
          return {
            id: asset.id,
            request_id: asset.request_id,
            stage: asset.stage,
            file_name: asset.file_name,
            mime_type: asset.mime_type,
            signedUrl: data?.signedUrl ?? "",
          };
        })
      );
      assetsWithUrls = urlResults.filter((a) => a.signedUrl);
    }
  }

  return (
    <ScheduleView
      slots={slots}
      requests={requests}
      assets={assetsWithUrls}
      timeslots={timeslots}
      editedRequests={editedRequests}
    />
  );
}
