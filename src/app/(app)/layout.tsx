import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import type { PersonaWithRole } from "@/lib/types/database";
import { PersonaProvider } from "@/hooks/use-persona";
import { PersonaRail } from "@/components/layout/persona-rail";
import { TopBar } from "@/components/layout/top-bar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";

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
          <Suspense fallback={null}>
            <PersonaRail />
          </Suspense>
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar
              userEmail={user.email ?? ""}
              userName={profile?.full_name ?? null}
              isModel={activePersona.role === "model"}
              withNav
            />
            <main className={`flex-1 overflow-auto p-4 pb-28 md:p-6 md:pb-8 ${activePersona.role === "model" ? "" : "md:pl-24"}`}>
              <div className="mx-auto w-full max-w-[1480px]">{children}</div>
            </main>
            <MobileBottomNav />
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
