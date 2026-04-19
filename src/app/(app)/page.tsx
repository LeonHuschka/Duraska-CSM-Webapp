import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import {
  Kanban,
  CalendarDays,
  Image,
  TrendingUp,
} from "lucide-react";
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
  const activeMembership = memberships?.find((m) => m.persona_id === activePersonaId) ?? memberships?.[0];
  if (activeMembership?.role === "model") {
    redirect("/produce");
  }

  const hasPersonas = memberships && memberships.length > 0;

  if (!hasPersonas) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <CreatePersonaCard />
      </div>
    );
  }

  const active =
    memberships.find((m) => m.persona_id === activePersonaId) ?? memberships[0];
  const persona = active?.personas as {
    name: string;
    brand_color: string;
  } | null;
  const personaId = active?.persona_id;

  const [requestsResult, slotsResult] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, status", { count: "exact" })
      .eq("persona_id", personaId),
    supabase
      .from("schedule_slots")
      .select("id, status", { count: "exact" })
      .eq("persona_id", personaId),
  ]);

  const totalRequests = requestsResult.count ?? 0;
  const totalSlots = slotsResult.count ?? 0;
  const postedSlots =
    slotsResult.data?.filter((s) => s.status === "posted").length ?? 0;
  const pendingRequests =
    requestsResult.data?.filter((r) =>
      ["requested", "shooted", "edited"].includes(r.status)
    ).length ?? 0;

  const stats = [
    {
      label: "Content Requests",
      value: totalRequests,
      icon: Kanban,
      href: "/requests",
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
    {
      label: "In Progress",
      value: pendingRequests,
      icon: Image,
      href: "/requests",
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Scheduled Slots",
      value: totalSlots,
      icon: CalendarDays,
      href: "/schedule",
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Posted",
      value: postedSlots,
      icon: TrendingUp,
      href: "/schedule",
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
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your content pipeline
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group rounded-xl border border-border/50 bg-card p-5 transition-all duration-200 hover:border-border hover:bg-accent/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <div className={`rounded-lg p-2 ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {stat.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/50 bg-card p-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            Quick Actions
          </h2>
          <div className="mt-4 grid gap-2">
            <Link
              href="/requests"
              className="flex items-center gap-3 rounded-lg bg-accent/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Kanban className="h-4 w-4 text-primary" />
              View Content Requests
            </Link>
            <Link
              href="/schedule"
              className="flex items-center gap-3 rounded-lg bg-accent/50 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <CalendarDays className="h-4 w-4 text-primary" />
              View Schedule
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            Pipeline Status
          </h2>
          <div className="mt-4 space-y-3">
            {["requested", "shooted", "edited", "scheduled", "posted"].map(
              (status) => {
                const count =
                  requestsResult.data?.filter((r) => r.status === status)
                    .length ?? 0;
                const percentage =
                  totalRequests > 0
                    ? Math.round((count / totalRequests) * 100)
                    : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-20 text-xs capitalize text-muted-foreground">
                      {status}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-medium tabular-nums">
                      {count}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
