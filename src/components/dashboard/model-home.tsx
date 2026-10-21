/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ChevronRight, Flame, FlaskConical } from "lucide-react";
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
    <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-card p-5">
      <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
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
  const H = 120;
  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">This week</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {shot} shot · {must} a day is the must · {must * 7} for the week
          </p>
        </div>
        <div className="text-right">
          <p
            className={`text-4xl font-black tabular-nums leading-none ${
              balance >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {balance > 0 ? "+" : balance < 0 ? "−" : "±"}
            {Math.abs(balance)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{balance >= 0 ? "ahead of the must" : "behind the must"}</p>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-2" style={{ height: H + 34 }}>
        {days.map((d, i) => {
          const future = i > todayIndex;
          const mustH = (must / top) * H;
          const valH = (d.value / top) * H;
          const met = d.value >= must;
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  future ? "text-transparent" : met ? "text-emerald-300" : d.value > 0 ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {d.value}
              </span>
              <div className="relative w-full" style={{ height: H }}>
                {/* The must: three, faint and dashed */}
                <div
                  className="absolute inset-x-0 bottom-0 rounded-lg border border-dashed border-foreground/20 bg-foreground/[0.04]"
                  style={{ height: mustH }}
                />
                {/* What she shot, laid over it */}
                {d.value > 0 && (
                  <div
                    className={`absolute inset-x-[3px] bottom-0 rounded-lg ${
                      met ? "bg-gradient-to-t from-emerald-500 to-emerald-300" : "bg-gradient-to-t from-violet-600 to-fuchsia-400"
                    } shadow-[0_0_14px_-2px] ${met ? "shadow-emerald-400/50" : "shadow-fuchsia-500/40"}`}
                    style={{ height: Math.max(6, valH) }}
                  />
                )}
              </div>
              <span className={`text-[10px] ${i === todayIndex ? "font-bold text-foreground" : "text-muted-foreground"}`}>{d.label}</span>
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
  brief: string;
};

const ROUND: Record<TrialCard["phase"], { n: number; label: string; emoji: string }> = {
  outfit: { n: 1, label: "6 outfits", emoji: "👗" },
  location: { n: 2, label: "6 locations", emoji: "📍" },
  hook: { n: 3, label: "6 hooks", emoji: "🪝" },
  done: { n: 3, label: "Pattern found", emoji: "🏁" },
};

/** The Trial-Maxxing jobs waiting for her, one card per outlier. */
export function TrialJobs({ trials }: { trials: TrialCard[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-fuchsia-400" /> Trial-Maxxing
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
          const pct = Math.round((t.shot / 6) * 100);
          return (
            <Link
              key={t.id}
              href={`/trials/${t.id}`}
              className="group flex items-stretch gap-3 overflow-hidden rounded-3xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/10 via-card to-card p-3 transition-colors active:bg-fuchsia-500/15"
            >
              <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl bg-muted ring-2 ring-amber-400">
                {t.cover ? <img src={t.cover} alt="" className="h-full w-full object-cover" /> : null}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-gradient-to-t from-black/80 to-transparent pb-1 pt-4 text-[10px] font-bold text-amber-300">
                  <Flame className="h-3 w-3" />
                  {t.views != null ? short(t.views) : "viral"}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  <AccountAvatar src={t.avatar} platform={t.platform} label={t.accountLabel} size={20} />
                  <span className="truncate text-xs font-medium">{t.accountLabel}</span>
                </div>
                <p className="mt-1.5 text-base font-semibold leading-tight">
                  {r.emoji} Round {r.n} · {r.label}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t.brief}</p>
                <div className="mt-auto pt-2">
                  <div className="flex gap-1">
                    {Array.from({ length: 6 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i < t.posted ? "bg-emerald-400" : i < t.shot ? "bg-fuchsia-400" : i < t.shot + t.started ? "bg-fuchsia-400/40" : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {t.phase === "done" ? "All rounds decided" : `${t.shot}/6 shot · ${pct}%`}
                    </span>
                    <span className="flex items-center font-semibold text-fuchsia-300">
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
