import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import { Scissors, Archive, Upload, Send } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = (await supabase
    .from("persona_members")
    .select("persona_id, role, personas(name, brand_color)")
    .eq("user_id", user.id)) as {
    data: Array<{
      persona_id: string;
      role: string;
      personas: { name: string; brand_color: string } | null;
    }> | null;
  };

  const cookieStore = await cookies();
  const activePersonaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  const activeMembership =
    memberships?.find((m) => m.persona_id === activePersonaId) ?? memberships?.[0];

  // The model's whole app is the Upload page.
  if (activeMembership?.role === "model") {
    redirect("/upload");
  }

  const hasPersonas = memberships && memberships.length > 0;
  if (!hasPersonas) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <CreatePersonaCard />
      </div>
    );
  }

  const active = activeMembership!;
  const persona = active.personas as { name: string; brand_color: string } | null;
  const personaId = active.persona_id;

  const { data: requests } = await supabase
    .from("content_requests")
    .select("status")
    .eq("persona_id", personaId);

  const count = (s: string) => requests?.filter((r) => r.status === s).length ?? 0;
  const toEdit = count("shooted");
  const readyToPost = count("edited");
  const posted = count("posted");

  const stats = [
    {
      label: "To edit",
      value: toEdit,
      icon: Scissors,
      href: "/editing",
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Ready to post",
      value: readyToPost,
      icon: Archive,
      href: "/vault",
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Posted",
      value: posted,
      icon: Send,
      href: "/vault",
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: persona?.brand_color ?? "#8b5cf6" }}
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            {persona?.name ?? "Dashboard"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Your content pipeline</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group rounded-xl border border-border/50 bg-card p-4 transition-all duration-200 hover:border-border hover:bg-accent/50"
          >
            <div className={`inline-flex rounded-lg p-2 ${stat.bg}`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {stat.value}
            </p>
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-medium text-muted-foreground">Quick actions</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Link
            href="/upload"
            className="flex items-center gap-3 rounded-lg bg-accent/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Upload className="h-4 w-4 text-primary" />
            Upload takes
          </Link>
          <Link
            href="/editing"
            className="flex items-center gap-3 rounded-lg bg-accent/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Scissors className="h-4 w-4 text-primary" />
            Editing queue
          </Link>
          <Link
            href="/vault"
            className="flex items-center gap-3 rounded-lg bg-accent/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Archive className="h-4 w-4 text-primary" />
            Vault
          </Link>
        </div>
      </div>
    </div>
  );
}
