/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ChevronRight, FlaskConical } from "lucide-react";
import { AccountAvatar } from "@/components/pipeline/account-avatar";

/**
 * The model's home, in three pieces she can act on: how much of the
 * inspo she has worked through, whether this week keeps up with what the
 * accounts need, and which Trial-Maxxing boxes are waiting for her.
 */


/** Inspo links: how many she has shot, as a ring. */
export function LinksDonut({ open, shot, topicHref }: { open: number; shot: number; topicHref: string | null }) {
  const total = open + shot;
  const pct = total > 0 ? shot / total : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5">
      <div className="relative flex items-center gap-5">
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 120 120" className="glass-glow h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" className="stroke-white/10" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              className="stroke-emerald-400 transition-all duration-700"
              strokeDasharray={`${C * pct} ${C}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums">{Math.round(pct * 100)}%</span>
            <span className="text-[10px] text-muted-foreground">shot</span>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-3xl font-bold tabular-nums text-amber-300">{open}</p>
            <p className="text-xs text-muted-foreground">inspo links still open</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-emerald-300">{shot}</p>
            <p className="text-xs text-muted-foreground">already shot</p>
          </div>
          {topicHref && (
            <a href={topicHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground underline underline-offset-2">
              Open the links <ChevronRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * How long the reels already in the pipe last: jobs waiting for a cut
 * plus finished reels nobody has posted yet, at the posts a day the
 * accounts run. Rounded down — half a day of reels is not a day.
 */
export function StockDays({ toEdit, fresh, perDay }: { toEdit: number; fresh: number; perDay: number }) {
  const days = Math.floor((toEdit + fresh) / perDay);
  const tone = days <= 3 ? "text-rose-400" : days <= 7 ? "text-amber-300" : "text-emerald-400";
  return (
    <div className="flex items-baseline gap-3 rounded-2xl border border-border/50 bg-card px-5 py-4">
      <span className={`text-5xl font-bold tabular-nums leading-none ${tone}`}>{days}</span>
      <span className="text-base font-semibold">{days === 1 ? "day" : "days"} covered</span>
    </div>
  );
}

/**
 * This week, day by day, against the three a day the accounts need: the
 * must as a faint dashed bar, what she shot laid over it, and one number
 * for where the week stands.
 */
export function WeekVsMust({
  days,
  must,
  todayIndex,
}: {
  days: { label: string; value: number; date: string }[];
  must: number;
  todayIndex: number;
}) {
  const shot = days.reduce((a, d) => a + d.value, 0);
  const due = must * (todayIndex + 1);
  const balance = shot - due;
  const today = days[todayIndex]?.value ?? 0;
  const top = Math.max(must + 1, ...days.map((d) => d.value));
  const H = 110;
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">This week</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {shot} shot · {must} a day is the must · {must * 7} for the week
          </p>
        </div>
        <div className="text-right">
          <p
            className={`text-3xl font-semibold tabular-nums leading-none ${
              balance >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {balance > 0 ? "+" : balance < 0 ? "−" : "±"}
            {Math.abs(balance)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{balance >= 0 ? "ahead of the must" : "behind the must"}</p>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-2">
        {days.map((d, i) => {
          const future = i > todayIndex;
          const isToday = i === todayIndex;
          const mustH = (must / top) * H;
          const valH = d.value > 0 ? Math.max(8, (d.value / top) * H) : 0;
          const met = d.value >= must;
          const missed = !future && !isToday && !met;
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="relative w-full" style={{ height: H }}>
                {/* The must: faint and dashed — red where a past day fell short */}
                <div
                  className={`absolute inset-x-0 bottom-0 rounded-full border border-dashed ${
                    missed
                      ? "border-rose-400/40 bg-rose-500/[0.07]"
                      : isToday
                        ? "border-foreground/40 bg-foreground/[0.05]"
                        : "border-foreground/15 bg-foreground/[0.03]"
                  }`}
                  style={{ height: mustH }}
                />
                {/* What she shot, laid over it */}
                {d.value > 0 && (
                  <div
                    className={`bar-shine absolute inset-x-[3px] bottom-0 rounded-full ${
                      met ? "bg-emerald-400" : "bg-primary"
                    }`}
                    style={{ height: valH }}
                  />
                )}
                {!future && (
                  <span
                    className={`absolute inset-x-0 text-center text-[11px] font-bold tabular-nums ${
                      met ? "text-emerald-300" : missed ? "text-rose-300" : d.value > 0 ? "text-foreground" : "text-muted-foreground"
                    }`}
                    style={{ bottom: Math.max(mustH, valH) + 3 }}
                  >
                    {d.value}
                  </span>
                )}
              </div>
              <span className={`text-[10px] ${isToday ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {isToday ? "Today" : d.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-center text-xs">
        Today: <b className="tabular-nums">{today}</b> of {must}
        {today >= must ? " — done for today 🎉" : ` — ${must - today} to go`}
      </p>
    </div>
  );
}

export type TrialCard = {
  id: string;
  accountLabel: string;
  platform: string;
  avatar: string | null;
  cover: string | null;
  views: number | null;
  lift: number | null;
  phase: "outfit" | "location" | "hook" | "done";
  shot: number;
  posted: number;
  started: number;
  toShoot: number;
  /** Reshoots in the current round. */
  total: number;
  brief: string;
  /** Every round's boxes: shot, posted, winner, asked for. */
  rounds: {
    dimension: "outfit" | "location" | "hook";
    emoji: string;
    title: string;
    cells: { state: "empty" | "takes" | "finished" | "edited" | "posted"; winner: boolean; requested: boolean }[];
  }[];
};

const ROUND: Record<TrialCard["phase"], { n: number; label: string; emoji: string }> = {
  outfit: { n: 1, label: "outfits", emoji: "👗" },
  location: { n: 2, label: "locations", emoji: "📍" },
  hook: { n: 3, label: "hooks", emoji: "🪝" },
  done: { n: 3, label: "Pattern found", emoji: "🏁" },
};

/** The Trial-Maxxing jobs waiting for her, one card per outlier. */
export function TrialJobs({ trials }: { trials: TrialCard[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-muted-foreground" /> Trial-Maxxing
        </h2>
        <span className="text-[11px] text-muted-foreground">reshoot what went viral</span>
      </div>
      {trials.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-muted-foreground">
          No Trial-Maxxing right now. When a reel goes viral, it shows up here.
        </p>
      ) : (
        trials.map((t) => {
          const r = ROUND[t.phase];
          const asked = t.rounds.reduce((a, rd) => a + rd.cells.filter((c) => c.requested).length, 0);
          return (
            <Link
              key={t.id}
              href={`/trials/${t.id}`}
              className="group flex items-stretch gap-3 overflow-hidden rounded-2xl border border-border/50 bg-card p-3 transition-colors active:bg-muted/40"
            >
              <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {t.cover ? <img src={t.cover} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <AccountAvatar src={t.avatar} platform={t.platform} label={t.accountLabel} size={20} />
                  <span className="truncate text-xs font-medium">{t.accountLabel}</span>
                  {asked > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      👉 {asked} to shoot
                    </span>
                  )}
                </div>
                {/* One row per round: a box per variation, green once shot. */}
                <div className="space-y-1">
                  {t.rounds.map((rd) => (
                    <div key={rd.dimension} className="flex items-center gap-1.5">
                      <span className="w-4 shrink-0 text-center text-xs" title={rd.title}>
                        {rd.emoji}
                      </span>
                      <div className="flex flex-1 gap-1">
                        {rd.cells.map((c, i) => (
                          <span
                            key={i}
                            className={`h-2 flex-1 rounded-full ${
                              c.state === "empty" ? "bg-muted" : c.state === "takes" ? "bg-emerald-400/40" : "bg-emerald-400"
                            } ${c.winner ? "ring-2 ring-amber-400" : c.requested ? "ring-1 ring-amber-300/80" : ""}`}
                          />
                        ))}
                      </div>
                      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                        {rd.cells.filter((c) => c.state !== "empty" && c.state !== "takes").length}/{rd.cells.length}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{t.phase === "done" ? "All rounds decided" : `Round ${r.n} of 3 · ${r.label}`}</span>
                  <span className="flex items-center font-medium text-foreground">
                    {t.toShoot > 0 && t.phase !== "done" ? "Shoot" : "Open"} <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </p>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
