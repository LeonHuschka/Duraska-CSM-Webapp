import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePersonaId } from "@/lib/persona";
import { totalFollowers } from "@/lib/funnel-dashboard";
import { LinkEditor } from "@/components/link/link-editor";

/**
 * The link-in-bio editor: the form on the left, the phone on the right,
 * and every keystroke shows up on the phone at once. Opens in its own tab
 * from the Link tab of the dashboard.
 */
export const dynamic = "force-dynamic";

export default async function LinkEditorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const personaId = await getActivePersonaId();
  if (!personaId) return <p className="p-6 text-sm text-muted-foreground">Select a persona first.</p>;

  const [{ data: profile }, { data: membership }, { data: persona }, { data: page }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
    supabase.from("personas").select("name").eq("id", personaId).maybeSingle(),
    supabase
      .from("funnel_pages")
      .select("*")
      .eq("persona_id", personaId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const canEdit = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  if (!canEdit) return <p className="p-6 text-sm text-muted-foreground">Only owners and managers can edit the page.</p>;

  const sign = async (path: string | null) => {
    if (!path) return null;
    const { data } = await supabase.storage.from("content-assets").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };
  const [coverUrl, openCoverUrl, buttonUrl, followers] = await Promise.all([
    sign(page?.cover_path ?? null),
    sign(page?.open_cover_path ?? null),
    sign(page?.button_image_path ?? null),
    totalFollowers(supabase, personaId),
  ]);

  return (
    <LinkEditor
      personaId={personaId}
      personaName={persona?.name ?? ""}
      page={page}
      pictures={{ cover: coverUrl, open_cover: openCoverUrl, button: buttonUrl }}
      followers={followers}
    />
  );
}
