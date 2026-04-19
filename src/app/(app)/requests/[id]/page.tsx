import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { RequestDetail } from "@/components/requests/request-detail";
import type { ContentRequest, ContentAsset } from "@/lib/types/database";

export type AssetWithUrl = ContentAsset & { signedUrl: string };

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

  // Generate signed URLs for all assets
  const assetsWithUrls: AssetWithUrl[] = await Promise.all(
    contentAssets.map(async (asset) => {
      const { data: signedUrlData } = await supabase.storage
        .from("content-assets")
        .createSignedUrl(asset.file_path, 3600);

      return {
        ...asset,
        signedUrl: signedUrlData?.signedUrl ?? "",
      };
    })
  );

  return (
    <RequestDetail
      request={request as ContentRequest}
      assets={assetsWithUrls}
      personaId={personaId}
    />
  );
}
