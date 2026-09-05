import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import { Upload, Eye, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  PipelineDonut,
  WeekBars,
  WeeklyGoal,
  PlatformBadges,
} from "@/components/dashboard/pipeline-donut";
import { PipelineTab } from "@/components/pipeline/pipeline-tab";
import { AccountsTab } from "@/components/pipeline/accounts-tab";
import { dailyDemand } from "@/lib/demand";

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
  searchParams?: Promise<{ view?: string; tab?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const tab = sp.tab === "accounts" ? "accounts" : "pipeline";
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
    .select("id, status, created_at")
    .eq("persona_id", personaId);

  const count = (s: string) => requests?.filter((r) => r.status === s).length ?? 0;
  const toEdit = count("shooted");
  const readyToPost = count("edited");

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
      .select("weekly_reel_target, chat_id, requests_thread_id")
      .eq("persona_id", personaId)
      .maybeSingle();
    // Each account posts at its own rate, so demand is their sum — a single
    // rate times the account count claimed six a day where the real answer
    // is three.
    const demand = await dailyDemand(supabase, personaId);
    // A manually set target wins over the account-derived one.
    const manualTarget = tgCfg?.weekly_reel_target ?? null;
    const weeklyTarget =
      manualTarget && manualTarget > 0
        ? manualTarget
        : Math.max(1, Math.round(demand.perDay * 7));

    // Only the three stages she has any feel for.
    const pipeline = [
      { label: "Open inspo", value: openLinks, color: "stroke-amber-400" },
      { label: "Shot", value: toEdit, color: "stroke-purple-400" },
      { label: "Edited", value: readyToPost, color: "stroke-emerald-400" },
    ];
    const pipelineTotal = pipeline.reduce((a, s) => a + s.value, 0);

    // The shelf, counted the same way the manager dashboard counts it:
    // finished cuts nobody has posted. A job is not the unit — it yields
    // several cuts and each goes out once — and counting jobs is why this
    // number and the manager's disagreed.
    const { data: cutRows } = await supabase
      .from("content_assets")
      .select("id, request_id, stage")
      .in("request_id", (requests ?? []).map((r) => r.id))
      .eq("stage", "edited")
      .is("deleted_at", null);
    const { data: postedSlots } = await supabase
      .from("schedule_slots")
      .select("asset_id, request_id, status")
      .eq("persona_id", personaId)
      .eq("status", "posted");
    const postedCutIds = new Set<string>();
    const postedJobsLegacy = new Set<string>();
    for (const s of postedSlots ?? []) {
      if (s.asset_id) postedCutIds.add(s.asset_id);
      else if (s.request_id) postedJobsLegacy.add(s.request_id);
    }
    const inStock = (cutRows ?? []).filter(
      (c) =>
        !postedCutIds.has(c.id) &&
        !(c.request_id && postedJobsLegacy.has(c.request_id))
    ).length;
    // What the accounts actually consume — not what she is asked to shoot.
    // Those are different numbers whenever the weekly goal is set by hand,
    // and using the goal would report a healthy buffer while it drains.
    const dailyOut = Math.max(1, demand.perDay);

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
              {demand.perDay} reels a day between them
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

      {/* Two views of the same operation: the content moving through, and
          the accounts it goes out on. */}
      <div>
        <div className="flex gap-1 rounded-xl border border-border/50 bg-card p-1">
          {(
            [
              { key: "pipeline", label: "Pipeline" },
              { key: "accounts", label: "Accounts" },
            ] as const
          ).map((t) => (
            <Link
              key={t.key}
              href={t.key === "pipeline" ? "/" : `/?tab=${t.key}`}
              scroll={false}
              className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        <div className="mt-5">
          {tab === "accounts" ? (
            <AccountsTab
              personaId={personaId}
              canEdit={active.role === "owner" || active.role === "manager"}
            />
          ) : (
            <PipelineTab
              personaId={personaId}
              canEdit={active.role === "owner" || active.role === "manager"}
            />
          )}
        </div>
      </div>

    </div>
  );
}
