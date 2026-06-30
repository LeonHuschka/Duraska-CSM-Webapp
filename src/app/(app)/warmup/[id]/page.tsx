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
  text_content: string | null;
  notes: string | null;
  status: string;
  posted_at: string | null;
  // directly-uploaded media on the slot
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  thumbnailUrl: string | null;
  signedUrl: string | null;
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

  // Sign each slot's own uploaded media (file + thumbnail) in one batch.
  const pathsToSign = new Set<string>();
  for (const s of slots ?? []) {
    if (s.file_path) pathsToSign.add(s.file_path);
    if (s.thumbnail_path) pathsToSign.add(s.thumbnail_path);
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

  const slotViews: WarmupSlotView[] = (slots ?? []).map((s) => ({
    id: s.id,
    day_number: s.day_number,
    position: s.position,
    asset_kind: s.asset_kind,
    text_content: s.text_content,
    notes: s.notes,
    status: s.status,
    posted_at: s.posted_at,
    file_path: s.file_path,
    file_name: s.file_name,
    mime_type: s.mime_type,
    thumbnailUrl: s.thumbnail_path ? urlByPath[s.thumbnail_path] ?? null : null,
    signedUrl: s.file_path ? urlByPath[s.file_path] ?? null : null,
  }));

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
      personaId={personaId}
      currentDay={currentDay}
    />
  );
}
