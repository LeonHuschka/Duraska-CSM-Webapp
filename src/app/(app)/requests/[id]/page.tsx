import { getActivePersonaId } from "@/lib/persona";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RequestDetail } from "@/components/requests/request-detail";
import type { ContentRequest, ContentAsset } from "@/lib/types/database";
import { instagramKey } from "@/lib/telegram";

export type AssetWithUrl = ContentAsset & {
  signedUrl: string;
  thumbnailUrl: string | null;
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const personaId = await getActivePersonaId();

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">
          Select a persona to view this request.
        </p>
      </div>
    );
  }

  // Fetch the request
  const { data: request, error: requestError } = await supabase
    .from("content_requests")
    .select("*")
    .eq("id", id)
    .eq("persona_id", personaId)
    .single();

  if (requestError || !request) {
    notFound();
  }

  // Fetch all assets for this request (excluding soft-deleted)
  const { data: assets } = await supabase
    .from("content_assets")
    .select("*")
    .eq("request_id", id)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true });

  const contentAssets = (assets ?? []) as ContentAsset[];

  // The inspo reel, if the bot kept a copy when its link was posted. Found
  // through the link tied to this job, or failing that by the post itself,
  // so a job created by hand with the same link still gets its picture.
  const inspoKey = request.inspo_link ? instagramKey(request.inspo_link) : null;
  const { data: inspoLinks } = await supabase
    .from("content_links")
    .select("request_id, url_key, video_path")
    .eq("persona_id", personaId)
    .not("video_path", "is", null)
    .or(`request_id.eq.${id}${inspoKey ? `,url_key.eq.${inspoKey}` : ""}`)
    .limit(2);
  let inspoVideoPath =
    inspoLinks?.find((l) => l.request_id === id)?.video_path ??
    inspoLinks?.[0]?.video_path ??
    request.inspo_video_path ??
    null;
  // A Trial-Maxxing box: the outlier it reshoots, as the trial page shows it.
  if (!inspoVideoPath) inspoVideoPath = await trialOutlierVideo(supabase, id);

  // Generate signed URLs for all assets (originals + thumbnails) in one batch
  const allPaths = new Set<string>();
  if (inspoVideoPath) allPaths.add(inspoVideoPath);
  for (const a of contentAssets) {
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

  const assetsWithUrls: AssetWithUrl[] = contentAssets.map((asset) => ({
    ...asset,
    signedUrl: urlByPath[asset.file_path] ?? "",
    thumbnailUrl: asset.thumbnail_path
      ? urlByPath[asset.thumbnail_path] ?? null
      : null,
  }));

  return (
    <RequestDetail
      request={request as ContentRequest}
      assets={assetsWithUrls}
      personaId={personaId}
      inspoVideoUrl={inspoVideoPath ? (urlByPath[inspoVideoPath] ?? null) : null}
    />
  );
}

/** The outlier video of the trial whose box made this job, if it is one. */
async function trialOutlierVideo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestId: string
): Promise<string | null> {
  const { data: cell } = await supabase.from("trial_cells").select("trial_id").eq("request_id", requestId).limit(1).maybeSingle();
  if (!cell) return null;
  const { data: t } = await supabase.from("trials").select("video_path, source_request_id").eq("id", cell.trial_id).maybeSingle();
  if (t?.video_path) return t.video_path;
  if (!t?.source_request_id) return null;
  // A reel of ours: its first finished cut.
  const { data: cut } = await supabase
    .from("content_assets")
    .select("file_path")
    .eq("request_id", t.source_request_id)
    .eq("stage", "edited")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return cut?.file_path ?? null;
}
