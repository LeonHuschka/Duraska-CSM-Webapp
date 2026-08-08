import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import { Scissors, Archive, Upload, Send, Eye, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  PipelineDonut,
  WeekBars,
  WeeklyGoal,
  PlatformBadges,
} from "@/components/dashboard/pipeline-donut";

// One colour per pipeline stage, used by the stat boxes and the donut alike
// so a number and its slice always read as the same thing.
const TONES: Record<string, string> = {
  purple: "text-purple-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  blue: "text-blue-400",
};

function StatBox({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint: string;
  tone: keyof typeof TONES | string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <p className={`text-2xl font-semibold tabular-nums ${TONES[tone] ?? ""}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-medium leading-tight">{label}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{hint}</p>
    </div>
  );
}

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
    const DAY = 24 * 60 * 60 * 1000;
    const weekAgo = Date.now() - 7 * DAY;
    const twoWeeksAgo = Date.now() - 14 * DAY;

    const uploadTimes = (requests ?? []).map((r) =>
      new Date(r.created_at).getTime()
    );
    const thisWeek = uploadTimes.filter((t) => t >= weekAgo).length;
    const lastWeek = uploadTimes.filter(
      (t) => t >= twoWeeksAgo && t < weekAgo
    ).length;

    // Uploads per day for the last 7 days (oldest → today).
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - i));
      const start = day.getTime();
      const end = start + DAY;
      return {
        label: dayNames[day.getDay()],
        value: uploadTimes.filter((t) => t >= start && t < end).length,
      };
    });

    // Inspo links from Telegram that still need her.
    const { data: links } = await supabase
      .from("content_links")
      .select("status, posted_at")
      .eq("persona_id", personaId);
    const openLinks = (links ?? []).filter((l) => l.status === "open").length;
    const shotNotUploaded = (links ?? []).filter((l) => l.status === "shot").length;
    const newLinksThisWeek = (links ?? []).filter(
      (l) => new Date(l.posted_at).getTime() >= weekAgo
    ).length;

    // How many accounts are actually consuming content right now. A reel can
    // only be posted once, so every live account raises what she has to shoot.
    const { data: liveAccountRows } = await supabase
      .from("accounts")
      .select("id, platform")
      .eq("persona_id", personaId)
      .not("status", "in", '("dead","paused")');
    const liveAccounts = liveAccountRows?.length ?? 0;

    // Per-platform counts for the little overlapping badges.
    const platformOrder = ["instagram", "facebook", "tiktok", "x"];
    const platformCounts = platformOrder
      .map((p) => ({
        platform: p,
        count: (liveAccountRows ?? []).filter((a) => a.platform === p).length,
      }))
      .filter((p) => p.count > 0);

    const { data: tgCfg } = await supabase
      .from("telegram_config")
      .select("posts_per_day, weekly_reel_target, chat_id, requests_thread_id")
      .eq("persona_id", personaId)
      .maybeSingle();
    const postsPerDay = tgCfg?.posts_per_day ?? 2;
    // A manually set target wins over the account-derived one.
    const manualTarget = tgCfg?.weekly_reel_target ?? null;
    const weeklyTarget =
      manualTarget && manualTarget > 0
        ? manualTarget
        : Math.max(1, liveAccounts * postsPerDay * 7);

    // Only the three stages she has any feel for.
    const pipeline = [
      { label: "Open inspo", value: openLinks, color: "stroke-amber-400" },
      { label: "Shot", value: toEdit, color: "stroke-purple-400" },
      { label: "Edited", value: readyToPost, color: "stroke-emerald-400" },
    ];
    const pipelineTotal = pipeline.reduce((a, s) => a + s.value, 0);

    // What she has delivered that nobody has posted yet — the shelf.
    const inStock = toEdit + readyToPost;
    // What the accounts actually consume — not what she is asked to shoot.
    // Those are different numbers whenever the weekly goal is set by hand,
    // and using the goal would report a healthy buffer while it drains.
    const dailyOut = Math.max(1, liveAccounts * postsPerDay);

    // Deep link into the requests topic, so "to shoot" is one tap from the
    // list it comes from. Supergroup ids carry a -100 prefix t.me won't take.
    const tgChat = tgCfg?.chat_id
      ? String(tgCfg.chat_id).replace(/^-100/, "")
      : null;
    const tgLink =
      tgChat && tgCfg?.requests_thread_id
        ? `https://t.me/c/${tgChat}/${tgCfg.requests_thread_id}`
        : null;

    const trend = thisWeek - lastWeek;

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

        {/* Hero: how far into this week's minimum she is */}
        <WeeklyGoal
          done={thisWeek}
          target={weeklyTarget}
          liveAccounts={liveAccounts}
          manual={!!manualTarget && manualTarget > 0}
          stockReels={inStock}
          perDay={dailyOut}
        />

        {/* Three numbers she can act on, each with context */}
        <div className="grid grid-cols-3 gap-2.5">
          <StatBox
            value={openLinks}
            label="To shoot"
            tone="amber"
            hint={
              newLinksThisWeek > 0 ? `${newLinksThisWeek} new this week` : "no new links"
            }
          />
          <StatBox
            value={thisWeek}
            label="Shot this week"
            tone="purple"
            hint={
              lastWeek === 0 && thisWeek === 0
                ? "let's go 💪"
                : trend > 0
                  ? `▲ ${trend} vs last week`
                  : trend < 0
                    ? `▼ ${Math.abs(trend)} vs last week`
                    : "same as last week"
            }
          />
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <div className="flex items-start justify-between gap-1">
              <p className="text-2xl font-semibold tabular-nums text-blue-400">
                {liveAccounts}
              </p>
              <PlatformBadges counts={platformCounts} />
            </div>
            <p className="mt-0.5 text-[11px] font-medium leading-tight">
              Live accounts
            </p>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
              {postsPerDay}× a day each
            </p>
          </div>
        </div>

        <p className="px-1 text-[11px] leading-snug text-muted-foreground/80">
          &ldquo;To shoot&rdquo; are the open inspo links in Telegram
          {tgLink ? (
            <>
              {" · "}
              <a
                href={tgLink}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                open the topic
              </a>
            </>
          ) : null}
        </p>

        {openLinks === 0 && (
          <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-300">
            🎉 No open links — you&apos;re fully caught up!
          </p>
        )}
        {shotNotUploaded > 0 && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            📤 {shotNotUploaded} reel{shotNotUploaded === 1 ? "" : "s"} marked as shot
            but not uploaded yet — send them over!
          </p>
        )}

        {/* Where everything sits right now */}
        {pipelineTotal > 0 && (
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <h2 className="mb-4 text-sm font-medium">Your pipeline</h2>
            <PipelineDonut
              segments={pipeline}
              centerLabel="reels"
              centerValue={pipelineTotal}
            />
          </div>
        )}

        {/* Consistency beats bursts — show the rhythm */}
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h2 className="mb-4 text-sm font-medium">Last 7 days shot</h2>
          <WeekBars days={weekDays} />
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
