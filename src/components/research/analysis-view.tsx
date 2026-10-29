import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { describeKey } from "@/lib/analysis/codebook";
import type { Finding, Pattern, ScopeStats } from "@/lib/analysis/stats";
import type { AnalysisBriefing, AnalysisStats } from "@/lib/analysis/report";

/**
 * Analysis: what winners have in common, per account, across accounts and
 * over time — every finding with its counts, so a line in the briefing can
 * always be traced back to how many reels carry it.
 */

const nf = new Intl.NumberFormat("de-DE");
const label = (key: string) => key.split(" + ").map(describeKey).join(" + ");
const pct = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : "–");

const CONF: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-sky-500/15 text-sky-300",
  weak: "bg-muted text-muted-foreground",
};
const COHORT: Record<string, string> = {
  winner: "bg-emerald-500/15 text-emerald-300",
  loser: "bg-rose-500/15 text-rose-300",
  control: "bg-muted text-muted-foreground",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Lines({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty ?? "—"}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground">•</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function FindingsTable({
  rows,
  cross,
  reels,
  patterns,
}: {
  rows: Finding[];
  cross?: boolean;
  reels: AnalysisStats["reels"];
  patterns?: Pattern[];
}) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Nothing clear yet.</p>;
  const byId = new Map(reels.map((r) => [r.id, r]));
  const size = new Map((patterns ?? []).map((p) => [p.label, p.winners.length]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr className="border-b border-border/50">
            <th className="py-2 pr-3 font-normal">Feature</th>
            <th className="py-2 pr-3 font-normal">Winners</th>
            <th className="py-2 pr-3 font-normal">Rest</th>
            <th className="py-2 pr-3 font-normal">Median lift with / without</th>
            {cross && <th className="py-2 pr-3 font-normal">Accounts</th>}
            <th className="py-2 pr-3 font-normal">Confidence</th>
            {patterns && <th className="py-2 pr-3 font-normal">Pattern</th>}
            <th className="py-2 font-normal">Examples</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.key} className="border-b border-border/30 align-top">
              <td className="py-2 pr-3 font-medium">{label(f.key)}</td>
              <td className="py-2 pr-3 tabular-nums">
                {f.winners.k}/{f.winners.n} <span className="text-muted-foreground">({pct(f.winners.k, f.winners.n)})</span>
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {f.rest.k}/{f.rest.n} <span className="text-muted-foreground">({pct(f.rest.k, f.rest.n)})</span>
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {f.liftWith?.toFixed(1) ?? "–"}× / {f.liftWithout?.toFixed(1) ?? "–"}×
              </td>
              {cross && (
                <td className="py-2 pr-3 tabular-nums">{f.accounts ? `${f.accounts.agree}/${f.accounts.total}` : "–"}</td>
              )}
              <td className="py-2 pr-3">
                {f.confidence ? (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${CONF[f.confidence]}`} title={`p=${f.p.toFixed(3)} · q=${f.q.toFixed(3)}`}>
                    {f.confidence}
                  </span>
                ) : (
                  <span className="text-muted-foreground" title={`p=${f.p.toFixed(3)} · q=${f.q.toFixed(3)}`}>
                    p={f.p.toFixed(2)}
                  </span>
                )}
              </td>
              {patterns && (
                <td className="py-2 pr-3 whitespace-nowrap">
                  {f.pattern ? (
                    <span
                      className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px]"
                      title="Findings with the same letter rest on the same winner reels: one observation, not several."
                    >
                      {f.pattern} · {size.get(f.pattern)} reels
                    </span>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              )}
              <td className="py-2">
                <div className="flex flex-wrap gap-1">
                  {f.examples.slice(0, 4).map((id) => {
                    const r = byId.get(id);
                    return r?.url ? (
                      <a key={id} href={r.url} target="_blank" rel="noreferrer" className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] hover:text-foreground">
                        {r.lift?.toFixed(1)}×
                      </a>
                    ) : null;
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScopeView({
  stats,
  cross,
  reels,
  brief,
}: {
  stats: ScopeStats;
  cross?: boolean;
  reels: AnalysisStats["reels"];
  brief?: { pattern: string; tell: string[]; avoid?: string[]; testing?: string[] } | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        {stats.winners} winners · {stats.losers} losers · {stats.controls} control reels compared
        {cross ? " · tested across accounts, an account's own median is its baseline" : ""}
      </p>
      {brief && (
        <Section title="Winning pattern" hint="Written by Claude from the strong and medium findings below — correlations, to be confirmed by shooting them.">
          <p className="text-sm">{brief.pattern}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-300">Tell the model</p>
              <Lines items={brief.tell} />
            </div>
            {brief.avoid && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-rose-300">Avoid</p>
                <Lines items={brief.avoid} />
              </div>
            )}
            {brief.testing && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-sky-300">Worth testing</p>
                <Lines items={brief.testing} />
              </div>
            )}
          </div>
        </Section>
      )}
      <Section
        title="What winners have more often"
        hint="Winners against the rest (losers and control). Strong: survives the correction for testing many features. Medium: p < 0.05. Weak: a hint."
      >
        {!!stats.patterns?.length && (
          <p className="mb-3 text-xs text-muted-foreground">
            These findings rest on {stats.patterns.length === 1 ? "one group" : `${stats.patterns.length} groups`} of winners:{" "}
            {stats.patterns.map((p) => `${p.label} (${p.winners.length} reels, ${p.findings} findings)`).join(" · ")}. Findings in
            one group are one look that worked, not separate evidence.
          </p>
        )}
        <FindingsTable rows={stats.positive.slice(0, 30)} cross={cross} reels={reels} patterns={stats.patterns} />
      </Section>
      <Section title="Combinations" hint="Two features together, corrected for every pair that could have been tried.">
        <FindingsTable rows={stats.combos} cross={cross} reels={reels} patterns={stats.patterns} />
      </Section>
      <Section title="What winners avoid" hint="Clearly more common in the rest than in winners.">
        <FindingsTable rows={stats.negative.slice(0, 15)} cross={cross} reels={reels} />
      </Section>
    </div>
  );
}

export function AnalysisView({
  stats,
  briefing,
  scope,
}: {
  stats: AnalysisStats | null;
  briefing: AnalysisBriefing | null;
  scope: string;
}) {
  if (!stats) {
    return (
      <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        No finished run yet. Start one — the first run watches the whole history once.
      </p>
    );
  }
  const scopes = [
    { key: "all", label: "All accounts" },
    ...stats.accounts.map((a) => ({ key: a.id, label: a.label })),
    { key: "time", label: "Over time" },
    { key: "reels", label: "Reels" },
  ];
  const account = stats.accounts.find((a) => a.id === scope);
  const accountBrief = account ? briefing?.accounts.find((b) => b.account === account.label) : null;

  return (
    <div className="space-y-4">
      {briefing && <p className="text-base font-medium">{briefing.headline}</p>}
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted/40 p-0.5">
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={`/research?scope=${s.key}`}
            scroll={false}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
              (scope || "all") === s.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {account ? (
        <ScopeView
          stats={account.stats}
          reels={stats.reels}
          brief={
            accountBrief
              ? { pattern: accountBrief.winning_pattern, tell: accountBrief.tell_the_model, avoid: accountBrief.avoid, testing: accountBrief.worth_testing }
              : null
          }
        />
      ) : scope === "time" ? (
        <div className="space-y-4">
          {briefing && (
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Rising">
                <Lines items={briefing.over_time.rising} empty="Nothing clearly rising." />
              </Section>
              <Section title="Fading">
                <Lines items={briefing.over_time.fading} empty="Nothing clearly fading." />
              </Section>
            </div>
          )}
          <Section
            title="Older against newer winners"
            hint={`Split at ${stats.time.splitAt ? new Date(stats.time.splitAt).toLocaleDateString("de-DE") : "–"}. Gap = share of winners with the feature minus share of the rest.`}
          >
            {stats.time.findings.length ? (
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-2 pr-3 font-normal">Feature</th>
                    <th className="py-2 pr-3 font-normal">Trend</th>
                    <th className="py-2 pr-3 font-normal">Gap before</th>
                    <th className="py-2 font-normal">Gap recent</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.time.findings.map((t) => (
                    <tr key={t.key} className="border-b border-border/30">
                      <td className="py-2 pr-3 font-medium">{label(t.key)}</td>
                      <td className={`py-2 pr-3 ${t.trend === "rising" ? "text-emerald-300" : "text-rose-300"}`}>{t.trend}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {t.before.gap >= 0 ? "+" : ""}
                        {Math.round(t.before.gap * 100)} pts <span className="text-muted-foreground">({t.before.winners}/{t.before.n} winners)</span>
                      </td>
                      <td className="py-2 tabular-nums">
                        {t.recent.gap >= 0 ? "+" : ""}
                        {Math.round(t.recent.gap * 100)} pts <span className="text-muted-foreground">({t.recent.winners}/{t.recent.n} winners)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground">Too few winners on one side of the split, or nothing moved.</p>
            )}
          </Section>
        </div>
      ) : scope === "reels" ? (
        <Section title="Reels in the comparison" hint="Every reel that was watched and counted, best first.">
          <ul className="divide-y divide-border/30">
            {stats.reels.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-2 text-xs">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${COHORT[r.cohort]}`}>{r.cohort}</span>
                <span className="w-14 shrink-0 tabular-nums">{r.lift?.toFixed(1)}×</span>
                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{r.views != null ? nf.format(r.views) : "–"}</span>
                <span className="w-36 shrink-0 truncate text-muted-foreground">
                  {stats.accounts.find((a) => a.id === r.accountId)?.label}
                </span>
                <span className="flex-1">{r.summary}</span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <ScopeView
          stats={stats.all}
          cross
          reels={stats.reels}
          brief={briefing ? { pattern: briefing.across_accounts.pattern, tell: briefing.across_accounts.tell_the_model } : null}
        />
      )}

      {briefing?.caveats.length ? (
        <p className="text-[11px] text-muted-foreground">⚠︎ {briefing.caveats.join(" · ")}</p>
      ) : null}
    </div>
  );
}
