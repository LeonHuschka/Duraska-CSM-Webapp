import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { WarmupAccountView } from "@/components/warmup/warmup-account-view";
import { WARMUP_DURATION_DAYS } from "@/lib/warmup-spec";

export interface WarmupSlotView {
  id: string;
  day_number: number;
  position: number;
  asset_kind: string;
  asset_id: string | null;
  text_content: string | null;
  notes: string | null;
  status: string;
  posted_at: string | null;
  // resolved media (if asset attached)
  thumbnailUrl: string | null;
  signedUrl: string | null;
  mime_type: string | null;
}

export interface PoolAsset {
  id: string;
  request_title: string;
  mime_type: string | null;
  thumbnailUrl: string | null;
  signedUrl: string;
  // ids of slots (across all accounts) this asset is already attached to
  usedCount: number;
}

export default async function WarmupAccountPage({
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
        <p className="text-muted-foreground">Select a persona.</p>
      </div>
    );
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .eq("persona_id", personaId)
    .single();

  if (!account) notFound();

  const { data: slots } = await supabase
    .from("warmup_slots")
    .select("*")
    .eq("account_id", id)
    .order("day_number", { ascending: true })
    .order("position", { ascending: true });

  // Warm-up pool: assets belonging to is_warmup requests for this persona.
  const { data: warmupRequests } = await supabase
    .from("content_requests")
    .select("id, title")
    .eq("persona_id", personaId)
    .eq("is_warmup", true)
    .limit(2000);
  const warmupReqIds = (warmupRequests ?? []).map((r) => r.id);
  const reqTitle = Object.fromEntries(
    (warmupRequests ?? []).map((r) => [r.id, r.title])
  );

  let poolAssetsRaw: {
    id: string;
    request_id: string;
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string | null;
  }[] = [];
  if (warmupReqIds.length > 0) {
    const { data } = await supabase
      .from("content_assets")
      .select("id, request_id, file_path, thumbnail_path, mime_type")
      .in("request_id", warmupReqIds)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(2000);
    poolAssetsRaw = data ?? [];
  }

  // How many warmup slots (across ALL accounts for this persona) already use
  // each asset — so the model can see what's been "used up" (1 image = 1 post).
  const allAssetIds = poolAssetsRaw.map((a) => a.id);
  const usedCount: Record<string, number> = {};
  if (allAssetIds.length > 0) {
    const { data: usedSlots } = await supabase
      .from("warmup_slots")
      .select("asset_id")
      .in("asset_id", allAssetIds);
    for (const s of usedSlots ?? []) {
      if (s.asset_id) usedCount[s.asset_id] = (usedCount[s.asset_id] ?? 0) + 1;
    }
  }

  // Collect every path we need signed (slot assets + pool assets), sign in batch.
  const slotAssetIds = (slots ?? [])
    .map((s) => s.asset_id)
    .filter(Boolean) as string[];
  let slotAssetById: Record<
    string,
    { file_path: string; thumbnail_path: string | null; mime_type: string | null }
  > = {};
  if (slotAssetIds.length > 0) {
    const { data } = await supabase
      .from("content_assets")
      .select("id, file_path, thumbnail_path, mime_type")
      .in("id", slotAssetIds);
    slotAssetById = Object.fromEntries(
      (data ?? []).map((a) => [
        a.id,
        { file_path: a.file_path, thumbnail_path: a.thumbnail_path, mime_type: a.mime_type },
      ])
    );
  }

  const pathsToSign = new Set<string>();
  for (const a of poolAssetsRaw) {
    pathsToSign.add(a.file_path);
    if (a.thumbnail_path) pathsToSign.add(a.thumbnail_path);
  }
  for (const a of Object.values(slotAssetById)) {
    pathsToSign.add(a.file_path);
    if (a.thumbnail_path) pathsToSign.add(a.thumbnail_path);
  }

  const urlByPath: Record<string, string> = {};
  const paths = Array.from(pathsToSign);
  const CHUNK = 500;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(paths.slice(i, i + CHUNK), 3600);
    for (const r of signed ?? []) {
      if (r.path) urlByPath[r.path] = r.signedUrl ?? "";
    }
  }

  const slotViews: WarmupSlotView[] = (slots ?? []).map((s) => {
    const a = s.asset_id ? slotAssetById[s.asset_id] : null;
    return {
      id: s.id,
      day_number: s.day_number,
      position: s.position,
      asset_kind: s.asset_kind,
      asset_id: s.asset_id,
      text_content: s.text_content,
      notes: s.notes,
      status: s.status,
      posted_at: s.posted_at,
      thumbnailUrl: a?.thumbnail_path ? urlByPath[a.thumbnail_path] ?? null : null,
      signedUrl: a ? urlByPath[a.file_path] ?? null : null,
      mime_type: a?.mime_type ?? null,
    };
  });

  const pool: PoolAsset[] = poolAssetsRaw
    .map((a) => {
      const signedUrl = urlByPath[a.file_path] ?? "";
      if (!signedUrl) return null;
      return {
        id: a.id,
        request_title: reqTitle[a.request_id] ?? "Untitled",
        mime_type: a.mime_type,
        thumbnailUrl: a.thumbnail_path ? urlByPath[a.thumbnail_path] ?? null : null,
        signedUrl,
        usedCount: usedCount[a.id] ?? 0,
      };
    })
    .filter(Boolean) as PoolAsset[];

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const currentDay = Math.min(
    WARMUP_DURATION_DAYS,
    Math.max(
      1,
      Math.floor((Date.now() - new Date(account.warmup_started_at).getTime()) / MS_PER_DAY) + 1
    )
  );

  return (
    <WarmupAccountView
      account={account}
      slots={slotViews}
      pool={pool}
      currentDay={currentDay}
    />
  );
}
