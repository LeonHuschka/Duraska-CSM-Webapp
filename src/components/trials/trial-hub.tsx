/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AccountAvatar } from "@/components/pipeline/account-avatar";
import { cn } from "@/lib/utils";
import type { TrialSummary } from "@/lib/trials";

/**
 * The winner hub: every Trial-Maxxing at a glance. What the model is asked
 * to shoot comes first, the running ones after, the decided ones below; a
 * trial whose account left the app folds away at the bottom.
 */

const ROUND: Record<TrialSummary["phase"], { n: number; label: string }> = {
  outfit: { n: 1, label: "Outfits" },
  location: { n: 2, label: "Locations" },
  hook: { n: 3, label: "Hooks" },
  done: { n: 3, label: "Pattern found" },
};

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const askedOf = (t: TrialSummary) => t.rounds.reduce((a, rd) => a + rd.cells.filter((c) => c.requested).length, 0);
const shotOf = (t: TrialSummary) =>
  t.rounds.reduce((a, rd) => a + rd.cells.filter((c) => c.state !== "empty" && c.state !== "takes").length, 0);

export function TrialHub({ trials }: { trials: TrialSummary[] }) {
  const live = trials.filter((t) => !t.accountGone);
  const gone = trials.filter((t) => t.accountGone);
  const toShoot = live.filter((t) => t.phase !== "done" && askedOf(t) > 0);
  const running = live.filter((t) => t.phase !== "done" && askedOf(t) === 0);
  const done = live.filter((t) => t.phase === "done");
  const boxes = toShoot.reduce((a, t) => a + askedOf(t), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Winner hub</h1>
          <p className="mt-1 max-w-xl text-sm text-white/60">
            Outliers reshot in three rounds — outfits, locations, hooks — until the pattern shows. Start one from a reel on the
            Accounts tab.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat value={live.filter((t) => t.phase !== "done").length} label="running" />
          <Stat value={boxes} label="boxes to shoot" tone="amber" />
          <Stat value={done.length} label="patterns found" tone="green" />
        </div>
      </div>

      {toShoot.length > 0 && (
        <Section title="To shoot" hint="asked for in SHOOTING">
          {toShoot.map((t) => (
            <TrialCard key={t.id} t={t} />
          ))}
        </Section>
      )}
      {running.length > 0 && (
        <Section title="Running" hint="nothing asked right now">
          {running.map((t) => (
            <TrialCard key={t.id} t={t} />
          ))}
        </Section>
      )}
      {toShoot.length + running.length === 0 && (
        <p className="rounded-3xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/50">
          No Trial-Maxxing running. When a reel goes viral, start one from the Accounts tab.
        </p>
      )}
      {done.length > 0 && (
        <Section title="Patterns found" hint="every round decided">
          {done.map((t) => (
            <TrialCard key={t.id} t={t} />
          ))}
        </Section>
      )}

      {gone.length > 0 && (
        <details className="group rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-white/60">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            {gone.length} trial{gone.length === 1 ? "" : "s"} of accounts no longer in the app
            <span className="ml-auto text-[11px] text-white/40">open one to archive it</span>
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {gone.map((t) => (
              <Link
                key={t.id}
                href={`/trials/${t.id}`}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2 opacity-70 transition-opacity hover:opacity-100"
              >
                <div className="aspect-[9/16] w-9 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  {t.cover && <img src={t.cover} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-[11px] text-white/45">
                    {shotOf(t)} shot · started {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-white/40" />
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "amber" | "green" }) {
  return (
    <div className="glass-pill flex items-baseline gap-1.5 rounded-full px-4 py-2">
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "amber" && value > 0 && "text-amber-300",
          tone === "green" && value > 0 && "text-emerald-300"
        )}
      >
        {value}
      </span>
      <span className="text-xs text-white/60">{label}</span>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-[11px] text-white/45">{hint}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function TrialCard({ t }: { t: TrialSummary }) {
  const asked = askedOf(t);
  const r = ROUND[t.phase];
  return (
    <Link
      href={`/trials/${t.id}`}
      className="group flex items-stretch gap-4 rounded-3xl border border-border/50 bg-card p-3 transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl bg-black/40">
        {t.cover && <img src={t.cover} alt="" className="h-full w-full object-cover" />}
        {t.views != null && (
          <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/55 px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">
            ▶ {compact(t.views)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{t.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
              <AccountAvatar src={t.avatar} platform={t.platform} label={t.accountLabel} size={16} />
              <span className="truncate">{t.accountLabel}</span>
              {t.lift != null && t.lift > 1 && <span className="shrink-0 text-emerald-300">{Math.round(t.lift)}×</span>}
            </p>
          </div>
          {asked > 0 && (
            <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              {asked} to shoot
            </span>
          )}
        </div>

        {/* One row per round: a box per variation, green once shot, gold for the winner. */}
        <div className="space-y-1">
          {t.rounds.map((rd) => (
            <div key={rd.dimension} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-center text-xs" title={rd.title}>
                {rd.emoji}
              </span>
              <div className="flex flex-1 gap-1">
                {rd.cells.length === 0 ? (
                  <span className="h-1.5 flex-1 rounded-full bg-white/5" />
                ) : (
                  rd.cells.map((c, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        c.state === "empty" ? "bg-white/10" : c.state === "takes" ? "bg-emerald-400/40" : "bg-emerald-400",
                        c.winner ? "ring-2 ring-amber-400" : c.requested && "ring-1 ring-amber-300/80"
                      )}
                    />
                  ))
                )}
              </div>
              <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-white/45">
                {rd.cells.filter((c) => c.state !== "empty" && c.state !== "takes").length}/{rd.cells.length}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-auto flex items-center justify-between text-[11px] text-white/50">
          <span>{t.phase === "done" ? "All rounds decided" : `Round ${r.n}/3 · ${r.label}`}</span>
          <span className="flex items-center font-medium text-white">
            Open <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </p>
      </div>
    </Link>
  );
}
