import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { VaultView } from "@/components/vault/vault-view";

export interface VaultAsset {
  id: string;
  request_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  stage: string;
  uploaded_at: string;
  signedUrl: string;
  // from request
  request_title: string;
  is_nsfw: boolean;
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
  const { data: requests } = await supabase
    .from("content_requests")
    .select("id, title, is_nsfw")
    .eq("persona_id", personaId)
    .limit(5000);

  const requestIds = (requests ?? []).map((r) => r.id);
  if (requestIds.length === 0) {
    return <VaultView assets={[]} />;
  }

  const requestMap = Object.fromEntries(
    (requests ?? []).map((r) => [r.id, { title: r.title, is_nsfw: r.is_nsfw }])
  );

  // 2. Most-recent non-deleted assets.
  // Higher cap so older edited+SFW content still appears once you filter
  // — we shoot a lot of NSFW Fansly so the older SFW pieces were getting
  // sliced off by a smaller limit. Egress stays low because vault-view
  // lazy-loads media via IntersectionObserver.
  const { data: assets } = await supabase
    .from("content_assets")
    .select("id, request_id, file_name, file_path, mime_type, size_bytes, stage, uploaded_at")
    .in("request_id", requestIds)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(2000);

  if (!assets || assets.length === 0) {
    return <VaultView assets={[]} />;
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

  // 4. Batch-generate all signed URLs. Chunked into pages of 500 because
  //    Supabase's storage endpoint has a body-size limit on the request
  //    array — passing thousands of paths in one call can fail silently.
  //    Chunks run in parallel so it's still fast.
  const paths = assets.map((a) => a.file_path);
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
      const req = requestMap[asset.request_id];
      return {
        id: asset.id,
        request_id: asset.request_id,
        file_name: asset.file_name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        stage: asset.stage,
        uploaded_at: asset.uploaded_at,
        signedUrl,
        request_title: req?.title ?? "Untitled",
        is_nsfw: req?.is_nsfw ?? false,
        platformStatus: slotsByRequest[asset.request_id] ?? {},
      } satisfies VaultAsset;
    })
    .filter(Boolean) as VaultAsset[];

  return <VaultView assets={assetsWithUrls} />;
}
