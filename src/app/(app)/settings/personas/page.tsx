import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { PersonaSettingsForm } from "@/components/personas/persona-settings-form";
import { MembersTable } from "@/components/personas/members-table";

export default async function PersonaSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <p className="text-muted-foreground">
        Select a persona to manage its settings.
      </p>
    );
  }

  const { data: persona } = await supabase
    .from("personas")
    .select("*")
    .eq("id", personaId)
    .single();

  if (!persona) {
    return (
      <p className="text-muted-foreground">Persona not found.</p>
    );
  }

  const { data: members } = await supabase
    .from("persona_members")
    .select("user_id, role, user_profiles(id, full_name, avatar_url)")
    .eq("persona_id", personaId) as {
    data:
      | Array<{
          user_id: string;
          role: string;
          user_profiles: {
            id: string;
            full_name: string | null;
            avatar_url: string | null;
          } | null;
        }>
      | null;
  };

  // Check current user's role for this persona
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("global_role")
    .eq("id", user.id)
    .single() as { data: { global_role: string } | null };

  const myMembership = members?.find((m) => m.user_id === user.id);
  const isOwner =
    profile?.global_role === "owner" || myMembership?.role === "owner";

  return (
    <div className="space-y-8">
      <PersonaSettingsForm
        persona={persona}
        canEdit={isOwner}
      />
      <MembersTable
        personaId={personaId}
        members={
          members?.map((m) => ({
            userId: m.user_id,
            role: m.role,
            fullName: m.user_profiles?.full_name ?? "Unknown",
            avatarUrl: m.user_profiles?.avatar_url ?? null,
          })) ?? []
        }
        currentUserId={user.id}
        canManage={isOwner}
      />
    </div>
  );
}
