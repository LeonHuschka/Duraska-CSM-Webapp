import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import type { PersonaWithRole } from "@/lib/types/database";
import { PersonaProvider } from "@/hooks/use-persona";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, global_role")
    .eq("id", user.id)
    .single() as { data: { full_name: string | null; global_role: string } | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await supabase
    .from("persona_members")
    .select("role, personas(id, name, slug, avatar_url, brand_color, platforms)")
    .eq("user_id", user.id) as { data: Array<{ role: string; personas: Record<string, unknown> | null }> | null; error: unknown };

  const personas: PersonaWithRole[] =
    memberships
      ?.filter((m) => m.personas)
      .map((m) => {
        const p = m.personas as unknown as PersonaWithRole;
        return { ...p, role: m.role as PersonaWithRole["role"] };
      }) ?? [];

  const cookieStore = await cookies();
  const savedPersonaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  const activePersona =
    personas.find((p) => p.id === savedPersonaId) ?? personas[0] ?? null;

  return (
    <div className="flex h-screen overflow-hidden">
      {activePersona ? (
        <PersonaProvider
          value={{ activePersona, personas }}
        >
          <div className="hidden md:flex md:w-[260px] md:shrink-0 border-r border-border/50 bg-card/80">
            <AppSidebar />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar
              userEmail={user.email ?? ""}
              userName={profile?.full_name ?? null}
            />
            <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
          </div>
        </PersonaProvider>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            userEmail={user.email ?? ""}
            userName={profile?.full_name ?? null}
          />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      )}
    </div>
  );
}
