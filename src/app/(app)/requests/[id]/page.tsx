import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { RequestDetail } from "@/components/requests/request-detail";
import type { ContentRequest, ContentAsset } from "@/lib/types/database";

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

  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

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

  // Generate signed URLs for all assets (originals + thumbnails) in one batch
  const allPaths = new Set<string>();
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
    />
  );
}
