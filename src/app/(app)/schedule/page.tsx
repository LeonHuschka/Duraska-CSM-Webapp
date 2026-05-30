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
        .select("id, title, status, is_trial")
        .eq("persona_id", personaId)
        .order("title", { ascending: true }),
      supabase
        .from("posting_timeslots")
        .select("*")
        .eq("persona_id", personaId)
        .order("position", { ascending: true }),
      // Pool candidates: include edited + scheduled + posted so SFW content
      // that's already on Fansly (status="scheduled"/"posted") still appears
      // in the IG / TikTok pool. The client-side pool logic uses
      // scheduledPlatformsMap to remove it per-platform once scheduled there.
      supabase
        .from("content_requests")
        .select("id, title, status, priority, content_type_id, is_nsfw, is_trial")
        .eq("persona_id", personaId)
        .in("status", ["edited", "scheduled", "posted"])
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
  for (const slot of pastScheduledSlots) {
    const { error } = await supabase
      .from("schedule_slots")
      .update({ status: "posted", posted_at: now.toISOString() })
      .eq("id", slot.id);
    if (!error) {
      slot.status = "posted";
      slot.posted_at = now.toISOString();
      if (slot.request_id) {
        await supabase
          .from("content_requests")
          .update({ status: "posted", updated_at: now.toISOString() })
          .eq("id", slot.request_id);
      }
    }
  }

  // Only fetch assets for non-posted slots.
  // Posted content doesn't need to be streamable in the schedule view — it lives in the Vault.
  const requestIds = Array.from(
    new Set(
      slots
        .filter((s) => s.status !== "posted")
        .map((s) => s.request_id)
        .filter(Boolean) as string[]
    )
  );

  let assetsWithUrls: Array<{
    id: string;
    request_id: string;
    stage: string;
    file_name: string;
    mime_type: string | null;
    signedUrl: string;
    thumbnailUrl: string | null;
  }> = [];

  if (requestIds.length > 0) {
    const { data: assets } = await supabase
      .from("content_assets")
      .select("id, request_id, stage, file_path, thumbnail_path, file_name, mime_type")
      .in("request_id", requestIds)
      .in("stage", ["edited", "final"])
      .is("deleted_at", null);

    if (assets && assets.length > 0) {
      // Sign originals + thumbnails in one batch each
      const allPaths = new Set<string>();
      for (const a of assets) {
        if (a.file_path) allPaths.add(a.file_path);
        if (a.thumbnail_path) allPaths.add(a.thumbnail_path);
      }
      const { data: signed } = await supabase.storage
        .from("content-assets")
        .createSignedUrls(Array.from(allPaths), 3600);

      const urlByPath: Record<string, string> = {};
      for (const r of signed ?? []) {
        if (r.path) urlByPath[r.path] = r.signedUrl ?? "";
      }

      assetsWithUrls = assets
        .map((asset) => {
          const signedUrl = urlByPath[asset.file_path] ?? "";
          if (!signedUrl) return null;
          return {
            id: asset.id,
            request_id: asset.request_id,
            stage: asset.stage,
            file_name: asset.file_name,
            mime_type: asset.mime_type,
            signedUrl,
            thumbnailUrl: asset.thumbnail_path
              ? urlByPath[asset.thumbnail_path] ?? null
              : null,
          };
        })
        .filter(Boolean) as typeof assetsWithUrls;
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
