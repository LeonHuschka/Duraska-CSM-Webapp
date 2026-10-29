/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ChevronRight, FlaskConical } from "lucide-react";
import { AccountAvatar } from "@/components/pipeline/account-avatar";

/**
 * The model's home, in three pieces she can act on: how much of the
 * inspo she has worked through, whether this week keeps up with what the
 * accounts need, and which Trial-Maxxing boxes are waiting for her.
 */

const nf = new Intl.NumberFormat("de-DE");
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : nf.format(n);

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
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="12" className="stroke-amber-400/15" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="12"
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
  const stock = toEdit + fresh;
  const days = Math.floor(stock / perDay);
  const tone = days <= 1 ? "text-rose-400" : days <= 3 ? "text-amber-300" : "text-emerald-400";
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-card p-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Reels in stock</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {toEdit} in editing · {fresh} ready to post · {perDay} posted a day
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-3xl font-semibold tabular-nums leading-none ${tone}`}>{days}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{days === 1 ? "day" : "days"} left</p>
      </div>
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
                  className={`absolute inset-x-0 bottom-0 rounded-lg border border-dashed ${
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
                    className={`absolute inset-x-[3px] bottom-0 rounded-lg ${
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
          const pct = t.total ? Math.round((t.shot / t.total) * 100) : 0;
          return (
            <Link
              key={t.id}
              href={`/trials/${t.id}`}
              className="group flex items-stretch gap-3 overflow-hidden rounded-2xl border border-border/50 bg-card p-3 transition-colors active:bg-muted/40"
            >
              <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {t.cover ? <img src={t.cover} alt="" className="h-full w-full object-cover" /> : null}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-gradient-to-t from-black/80 to-transparent pb-1 pt-4 text-[10px] font-semibold text-white">
                  {t.views != null ? short(t.views) : "viral"}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  <AccountAvatar src={t.avatar} platform={t.platform} label={t.accountLabel} size={20} />
                  <span className="truncate text-xs font-medium">{t.accountLabel}</span>
                </div>
                <p className="mt-1.5 text-sm font-medium leading-tight">
                  Round {r.n} of 3 · {t.phase === "done" ? r.label : `${t.total} ${r.label}`}
                </p>
                <div className="mt-auto pt-2">
                  <div className="flex gap-1">
                    {Array.from({ length: t.total }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i < t.posted ? "bg-emerald-400" : i < t.shot ? "bg-foreground/70" : i < t.shot + t.started ? "bg-foreground/30" : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {t.phase === "done" ? "All rounds decided" : `${t.shot}/${t.total} shot · ${pct}%`}
                    </span>
                    <span className="flex items-center font-medium text-foreground">
                      {t.toShoot > 0 && t.phase !== "done" ? "Shoot" : "Open"} <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </p>
                </div>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
