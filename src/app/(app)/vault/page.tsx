import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { VaultView } from "@/components/vault/vault-view";

export interface VaultAsset {
  id: string;
  request_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  stage: string;
  uploaded_at: string;
  signedUrl: string;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  // from request
  request_title: string;
  is_nsfw: boolean;
  is_trial: boolean;
  // posting info: platform → best status
  platformStatus: Record<string, string>;
}

export default async function VaultPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to view the vault.</p>
      </div>
    );
  }

  // 1. All requests for this persona (lightweight — just what we need).
  //    Explicit high limit to bypass the default 1000-row cap.
  //    Also fetch content_types in parallel for the self-upload dialog.
  const [requestsResult, typesResult] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, title, is_nsfw, is_trial")
      .eq("persona_id", personaId)
      .limit(5000),
    supabase
      .from("content_types")
      .select("id, name")
      .eq("persona_id", personaId)
      .order("position", { ascending: true }),
  ]);
  const requests = requestsResult.data;
  const contentTypes = (typesResult.data ?? []) as { id: string; name: string }[];

  const requestIds = (requests ?? []).map((r) => r.id);
  if (requestIds.length === 0) {
    return <VaultView assets={[]} personaId={personaId} contentTypes={contentTypes} />;
  }

  const requestMap = Object.fromEntries(
    (requests ?? []).map((r) => [
      r.id,
      { title: r.title, is_nsfw: r.is_nsfw, is_trial: r.is_trial },
    ])
  );

  // 2. Most-recent non-deleted assets.
  // Higher cap so older edited+SFW content still appears once you filter
  // — we shoot a lot of NSFW Fansly so the older SFW pieces were getting
  // sliced off by a smaller limit. Egress stays low because vault-view
  // lazy-loads media via IntersectionObserver.
  const { data: assets } = await supabase
    .from("content_assets")
    .select(
      "id, request_id, file_name, file_path, thumbnail_path, mime_type, size_bytes, stage, uploaded_at"
    )
    .in("request_id", requestIds)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(2000);

  if (!assets || assets.length === 0) {
    return (
      <VaultView assets={[]} personaId={personaId} contentTypes={contentTypes} />
    );
  }

  // 3. All schedule slots for those requests (to build posting status)
  const { data: slots } = await supabase
    .from("schedule_slots")
    .select("request_id, platform, status")
    .eq("persona_id", personaId)
    .in("request_id", requestIds);

  // Build platform-status map per request: posted > scheduled > planned
  const STATUS_RANK: Record<string, number> = { posted: 3, scheduled: 2, planned: 1 };
  const slotsByRequest: Record<string, Record<string, string>> = {};
  for (const slot of slots ?? []) {
    const rid = slot.request_id;
    if (!rid) continue;
    if (!slotsByRequest[rid]) slotsByRequest[rid] = {};
    const existing = slotsByRequest[rid][slot.platform];
    const newRank = STATUS_RANK[slot.status] ?? 0;
    const oldRank = STATUS_RANK[existing] ?? 0;
    if (newRank > oldRank) {
      slotsByRequest[rid][slot.platform] = slot.status;
    }
  }

  // 4. Batch-sign URLs for both originals and thumbnails. Chunked into
  //    pages of 500 because Supabase's storage endpoint has a body-size
  //    limit. Chunks run in parallel so it's still fast.
  //    Note: signing is metadata-only — it does NOT cost egress; only
  //    the actual byte fetch by the browser does.
  const allPaths = new Set<string>();
  for (const a of assets) {
    if (a.file_path) allPaths.add(a.file_path);
    if (a.thumbnail_path) allPaths.add(a.thumbnail_path);
  }
  const paths = Array.from(allPaths);
  const SIGN_CHUNK = 500;
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
    chunks.push(paths.slice(i, i + SIGN_CHUNK));
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      supabase.storage.from("content-assets").createSignedUrls(chunk, 3600)
    )
  );
  const urlByPath: Record<string, string> = {};
  for (const { data: chunkData } of chunkResults) {
    for (const r of chunkData ?? []) {
      if (r.path) urlByPath[r.path] = r.signedUrl ?? "";
    }
  }

  const assetsWithUrls: VaultAsset[] = assets
    .map((asset) => {
      const signedUrl = urlByPath[asset.file_path] ?? "";
      if (!signedUrl) return null;
      const thumbnailUrl = asset.thumbnail_path
        ? urlByPath[asset.thumbnail_path] ?? null
        : null;
      const req = requestMap[asset.request_id];
      return {
        id: asset.id,
        request_id: asset.request_id,
        file_name: asset.file_name,
        file_path: asset.file_path,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        stage: asset.stage,
        uploaded_at: asset.uploaded_at,
        signedUrl,
        thumbnailUrl,
        thumbnailPath: asset.thumbnail_path ?? null,
        request_title: req?.title ?? "Untitled",
        is_nsfw: req?.is_nsfw ?? false,
        is_trial: req?.is_trial ?? false,
        platformStatus: slotsByRequest[asset.request_id] ?? {},
      } satisfies VaultAsset;
    })
    .filter(Boolean) as VaultAsset[];

  return (
    <VaultView
      assets={assetsWithUrls}
      personaId={personaId}
      contentTypes={contentTypes}
    />
  );
}
