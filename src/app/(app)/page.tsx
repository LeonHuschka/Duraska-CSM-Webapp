import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import { Scissors, Archive, Upload, Send, Film, Eye, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const sp = (await searchParams) ?? {};
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

  // A model is pinned to her own persona; staff use the cookie.
  const modelMembership = memberships?.find((m) => m.role === "model");
  const cookieStore = await cookies();
  const activePersonaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;
  const activeMembership =
    modelMembership ??
    memberships?.find((m) => m.persona_id === activePersonaId) ??
    memberships?.[0];

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
    .select("status, created_at")
    .eq("persona_id", personaId);

  const count = (s: string) => requests?.filter((r) => r.status === s).length ?? 0;
  const toEdit = count("shooted");
  const readyToPost = count("edited");
  const posted = count("posted");

  // ── Model dashboard ──
  // The model always lands here; owners/managers can preview it via
  // ?view=model to see exactly what she sees.
  const isModel = active.role === "model";
  const previewingModel = !isModel && sp.view === "model";
  if (isModel || previewingModel) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek =
      requests?.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length ?? 0;
    const totalUploaded = requests?.length ?? 0;

    // Inspo links from Telegram that still need her.
    const { data: links } = await supabase
      .from("content_links")
      .select("status")
      .eq("persona_id", personaId);
    const openLinks = (links ?? []).filter((l) => l.status === "open").length;
    const shotNotUploaded = (links ?? []).filter((l) => l.status === "shot").length;
    const doneLinks = (links ?? []).filter((l) =>
      ["uploaded", "edited"].includes(l.status)
    ).length;
    const totalLinks = openLinks + shotNotUploaded + doneLinks;
    const donePct =
      totalLinks > 0 ? Math.round((doneLinks / totalLinks) * 100) : 0;

    return (
      <div className="mx-auto max-w-md space-y-6">
        {previewingModel && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <Eye className="h-3.5 w-3.5" />
              Model view
            </span>
            <Link
              href="/"
              className="flex items-center gap-1 text-xs text-amber-300/80 hover:text-amber-200"
            >
              <ArrowLeft className="h-3 w-3" /> Back to yours
            </Link>
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hey{persona?.name ? ` ${persona.name}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s where your reels stand.
          </p>
        </div>

        {/* To-do — the number she can actually act on */}
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Reels to shoot</span>
            <div className="rounded-lg bg-purple-400/10 p-2">
              <Film className="h-4 w-4 text-purple-400" />
            </div>
          </div>
          <p className="mt-2 text-4xl font-semibold tracking-tight">{openLinks}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {openLinks === 0
              ? "All caught up — amazing work 🎉"
              : "Inspo links waiting in Telegram."}
          </p>

          {totalLinks > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-400 to-emerald-400 transition-all"
                  style={{ width: `${donePct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {doneLinks} of {totalLinks} done ({donePct}%)
              </p>
            </div>
          )}

          {shotNotUploaded > 0 && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              📤 {shotNotUploaded} shot but not uploaded yet — send them over!
            </p>
          )}
        </div>

        {/* Buffer at the editor */}
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Waiting to be cut</span>
            <div className="rounded-lg bg-blue-400/10 p-2">
              <Scissors className="h-4 w-4 text-blue-400" />
            </div>
          </div>
          <p className="mt-2 text-4xl font-semibold tracking-tight">{toEdit}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {toEdit === 0
              ? "Nothing in the queue right now."
              : "Your editor is working through these."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-2xl font-semibold tracking-tight">{thisWeek}</p>
            <span className="text-xs text-muted-foreground">This week</span>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-2xl font-semibold tracking-tight">
              {readyToPost + posted}
            </p>
            <span className="text-xs text-muted-foreground">Finished</span>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-2xl font-semibold tracking-tight">{totalUploaded}</p>
            <span className="text-xs text-muted-foreground">All time</span>
          </div>
        </div>

        <Link href="/upload" className="block">
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground">
            <Upload className="h-5 w-5" />
            Upload a new reel
          </div>
        </Link>
      </div>
    );
  }

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
        <Link
          href="/?view=model"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" />
          See the model&apos;s dashboard
        </Link>
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
