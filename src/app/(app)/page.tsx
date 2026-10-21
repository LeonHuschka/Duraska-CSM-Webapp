import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { CreatePersonaCard } from "@/components/personas/create-persona-card";
import { Upload, Eye, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { LinksDonut, TrialJobs, WeekVsMust } from "@/components/dashboard/model-home";
import { listTrials } from "@/lib/trials";
import { PipelineTab } from "@/components/pipeline/pipeline-tab";

// The "Scrape now" action on the accounts tab runs inside this route and
// reads every account off its platform; Facebook can take two minutes.
export const maxDuration = 300;
import { AccountsTab } from "@/components/pipeline/accounts-tab";
import { LinkTab } from "@/components/pipeline/link/link-tab";
import { PERIODS, type PeriodKey } from "@/lib/account-analytics";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; tab?: string; period?: string; days?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const tab = sp.tab === "accounts" ? "accounts" : sp.tab === "link" ? "link" : "pipeline";
  const linkDays = ([7, 30, 90] as const).find((d) => String(d) === sp.days) ?? 7;
  const period = PERIODS.some((p) => p.key === sp.period) ? (sp.period as PeriodKey) : "30d";
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

  // ── Model dashboard ──
  // The model always lands here; owners/managers can preview it via
  // ?view=model to see exactly what she sees.
  const isModel = active.role === "model";
  const previewingModel = !isModel && sp.view === "model";
  if (isModel || previewingModel) {
    // ── Shot this week, day by day, in her time zone ──
    // Counted by when a reel was shot — the moment its takes went to
    // editing — not when its job was created: a job made for her by the
    // team, or one opened in Trial-Maxxing and finished two days later,
    // counts on the day she actually delivered it.
    const MUST_PER_DAY = 3;
    const TZ = "Europe/Berlin";
    const dayKey = (t: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(t);
    const todayKey = dayKey(new Date());
    const weekday = (new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const keyAt = (offset: number) => {
      const d = new Date(`${todayKey}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const weekKeys = Array.from({ length: 7 }, (_, i) => keyAt(i - weekday));
    const since = new Date(`${weekKeys[0]}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 1);
    const { data: shotRows } = await supabase
      .from("content_requests")
      .select("shooted_at, status")
      .eq("persona_id", personaId)
      .not("shooted_at", "is", null)
      .neq("status", "requested")
      .gte("shooted_at", since.toISOString());
    const perDay = new Map<string, number>();
    for (const r of shotRows ?? []) {
      const k = dayKey(new Date(r.shooted_at!));
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const week = weekKeys.map((k, i) => ({ label: labels[i], date: k, value: perDay.get(k) ?? 0 }));

    // ── Inspo links: open against shot ──
    const { data: links } = await supabase
      .from("content_links")
      .select("status")
      .eq("persona_id", personaId);
    const openLinks = (links ?? []).filter((l) => l.status === "open").length;
    const shotLinks = (links ?? []).filter((l) => ["shot", "uploaded", "edited"].includes(l.status)).length;
    const shotNotUploaded = (links ?? []).filter((l) => l.status === "shot").length;

    const { data: tgCfg } = await supabase
      .from("telegram_config")
      .select("chat_id, requests_thread_id")
      .eq("persona_id", personaId)
      .maybeSingle();
    const tgChat = tgCfg?.chat_id ? String(tgCfg.chat_id).replace(/^-100/, "") : null;
    const tgLink = tgChat && tgCfg?.requests_thread_id ? `https://t.me/c/${tgChat}/${tgCfg.requests_thread_id}` : null;

    // ── Trial-Maxxing waiting for her ──
    const trials = await listTrials(supabase, personaId);

    return (
      <div className="mx-auto max-w-md space-y-5 pb-6">
        {previewingModel && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <Eye className="h-3.5 w-3.5" />
              Model view
            </span>
            <Link href="/" className="flex items-center gap-1 text-xs text-amber-300/80 hover:text-amber-200">
              <ArrowLeft className="h-3 w-3" /> Back to yours
            </Link>
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hey{persona?.name ? ` ${persona.name}` : ""} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s where your reels stand.</p>
        </div>

        <LinksDonut open={openLinks} shot={shotLinks} topicHref={tgLink} />

        <WeekVsMust days={week} must={MUST_PER_DAY} todayIndex={weekday} />

        {shotNotUploaded > 0 && (
          <p className="rounded-2xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
            📤 {shotNotUploaded} reel{shotNotUploaded === 1 ? "" : "s"} marked as shot but not uploaded yet — send them over!
          </p>
        )}

        <TrialJobs trials={trials} />

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
              { key: "link", label: "Link" },
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
              period={period}
            />
          ) : tab === "link" ? (
            <LinkTab
              personaId={personaId}
              days={linkDays}
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
