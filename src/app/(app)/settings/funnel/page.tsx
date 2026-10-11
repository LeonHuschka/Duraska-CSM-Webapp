import { createClient } from "@/lib/supabase/server";
import { getActivePersonaId } from "@/lib/persona";
import { funnelStats } from "@/lib/funnel";
import { FunnelSettings } from "@/components/settings/funnel-settings";

export const dynamic = "force-dynamic";

export default async function FunnelSettingsPage() {
  const supabase = await createClient();
  const personaId = await getActivePersonaId();
  if (!personaId) return <p className="text-muted-foreground">Select a persona first.</p>;

  const { data: page } = await supabase
    .from("funnel_pages")
    .select("*")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [{ data: persona }, week, month] = await Promise.all([
    supabase.from("personas").select("name").eq("id", personaId).maybeSingle(),
    page ? funnelStats(supabase, page.id, 7) : Promise.resolve(null),
    page ? funnelStats(supabase, page.id, 30) : Promise.resolve(null),
  ]);

  let coverUrl: string | null = null;
  if (page?.cover_path) {
    const { data } = await supabase.storage.from("content-assets").createSignedUrl(page.cover_path, 3600);
    coverUrl = data?.signedUrl ?? null;
  }

  return (
    <FunnelSettings
      personaId={personaId}
      personaName={persona?.name ?? ""}
      page={page}
      coverUrl={coverUrl}
      week={week}
      month={month}
    />
  );
}
