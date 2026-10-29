import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { describeKey } from "@/lib/analysis/codebook";
import type { Finding, Pattern, ScopeStats, Shared } from "@/lib/analysis/stats";
import { SMALL, type AnalysisBriefing, type AnalysisStats } from "@/lib/analysis/report";

/** Per reel id: its cover (signed) and what Gemini saw in its first seconds. */
export type ReelMedia = Record<string, { cover: string | null; hook: string | null }>;

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

/** Covers of the reels that show a feature, each opening the reel. */
function Thumbs({ ids, reels, media, size = "sm" }: { ids: string[]; reels: AnalysisStats["reels"]; media: ReelMedia; size?: "sm" | "lg" }) {
  const byId = new Map(reels.map((r) => [r.id, r]));
  const box = size === "lg" ? "h-40 w-[90px]" : "h-12 w-[27px]";
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const r = byId.get(id);
        if (!r) return null;
        const cover = media[id]?.cover;
        return (
          <a
            key={id}
            href={r.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            title={r.summary}
            className={`relative ${box} shrink-0 overflow-hidden rounded-md bg-muted/60 hover:ring-1 hover:ring-primary`}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : null}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-0.5 text-center text-[9px] tabular-nums text-white">
              {r.lift?.toFixed(size === "lg" ? 1 : 0)}×
            </span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * One card per pattern: the reels it rests on, what they share in plain
 * words with the counts behind it, and what each reel actually shows.
 */
function PatternCards({ stats, reels, media }: { stats: ScopeStats; reels: AnalysisStats["reels"]; media: ReelMedia }) {
  const patterns = (stats.patterns ?? []).filter((p) => p.winners.length >= 2).slice(0, 3);
  if (!patterns.length) return null;
  const byId = new Map(reels.map((r) => [r.id, r]));
  const all = [...stats.positive, ...stats.combos];
  return (
    <Section
      title="What it looks like"
      hint="Each look is a group of winners that share these features. Open a reel to see it; the counts say how much the look stands out."
    >
      <div className="space-y-5">
        {patterns.map((p) => {
          const findings = all.filter((f) => f.pattern === p.label).sort((a, b) => a.p - b.p);
          const singles = Array.from(new Set(findings.flatMap((f) => f.key.split(" + "))));
          const lead = findings[0];
          const shown = p.winners
            .map((id) => byId.get(id))
            .filter((r): r is NonNullable<typeof r> => !!r)
            .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
            .slice(0, 3);
          return (
            <div key={p.label} className="grid gap-4 border-t border-border/30 pt-4 first:border-0 first:pt-0 md:grid-cols-[auto_1fr]">
              <Thumbs ids={shown.map((r) => r.id)} reels={reels} media={media} size="lg" />
              <div className="space-y-2 text-xs">
                <p className="text-sm font-medium">
                  Look {p.label} · {p.winners.length} winners
                </p>
                <p className="text-muted-foreground">
                  {singles.map(describeKey).join(" · ")}
                </p>
                {lead && (
                  <p>
                    Strongest sign: <span className="font-medium">{label(lead.key)}</span> — {lead.winners.k} of {lead.winners.n}{" "}
                    winners, {lead.rest.k} of {lead.rest.n} other reels. Reels with it run at a median {lead.liftWith?.toFixed(1)}×,
                    without it {lead.liftWithout?.toFixed(1)}×.{" "}
                    <span className="text-muted-foreground">
                      ({lead.confidence ?? "no"} evidence{lead.accounts ? `, ${lead.accounts.agree}/${lead.accounts.total} accounts agree` : ""})
                    </span>
                  </p>
                )}
                <ul className="space-y-1.5 pt-1">
                  {shown.map((r) => (
                    <li key={r.id} className="leading-relaxed">
                      <span className="tabular-nums text-emerald-300">{r.lift?.toFixed(1)}×</span> {r.summary}
                      {media[r.id]?.hook && <span className="text-muted-foreground"> Opening: {media[r.id]?.hook}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** For an account with too few winners to test: what they share, and which cross-account findings they match. */
function SmallAccount({
  stats,
  across,
  reels,
  media,
}: {
  stats: ScopeStats;
  across: Finding[];
  reels: AnalysisStats["reels"];
  media: ReelMedia;
}) {
  const shared: Shared[] = stats.shared ?? [];
  const winnerIds = new Set(reels.filter((r) => r.cohort === "winner").map((r) => r.id));
  return (
    <Section
      title="What its winners share so far"
      hint={`Only ${stats.winners} winner${stats.winners === 1 ? "" : "s"} yet — too few to test, so this describes them rather than proves anything. It firms up with every new winner.`}
    >
      <div className="space-y-4">
        <Thumbs ids={Array.from(winnerIds)} reels={reels} media={media} size="lg" />
        {shared.length ? (
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="py-2 pr-3 font-normal">Feature</th>
                <th className="py-2 pr-3 font-normal">Winners</th>
                <th className="py-2 font-normal">Rest</th>
              </tr>
            </thead>
            <tbody>
              {shared.map((x) => (
                <tr key={x.key} className="border-b border-border/30">
                  <td className="py-2 pr-3 font-medium">{describeKey(x.key)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {x.winners.k}/{x.winners.n}
                  </td>
                  <td className="py-2 tabular-nums">
                    {x.rest.k}/{x.rest.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted-foreground">Its winners have nothing clearly in common yet.</p>
        )}
        {!!across.length && (
          <div className="text-xs">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-300">Matches what works across accounts</p>
            <ul className="space-y-1">
              {across.map((f) => (
                <li key={f.key}>
                  {label(f.key)}{" "}
                  <span className="text-muted-foreground">
                    — {f.winners.k}/{f.winners.n} winners overall, {f.rest.k}/{f.rest.n} other reels
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function FindingsTable({
  rows,
  cross,
  reels,
  patterns,
  media,
}: {
  rows: Finding[];
  cross?: boolean;
  reels: AnalysisStats["reels"];
  patterns?: Pattern[];
  media: ReelMedia;
}) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Nothing clear yet.</p>;
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
                <Thumbs ids={f.examples.slice(0, 5)} reels={reels} media={media} />
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
  media,
  across,
  brief,
}: {
  stats: ScopeStats;
  cross?: boolean;
  reels: AnalysisStats["reels"];
  media: ReelMedia;
  /** For one account: the cross-account findings its winners show. */
  across?: Finding[];
  brief?: { pattern: string; tell: string[]; avoid?: string[]; testing?: string[] } | null;
}) {
  const small = !cross && stats.winners < SMALL;
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
      <PatternCards stats={stats} reels={reels} media={media} />
      {small && stats.winners > 0 && <SmallAccount stats={stats} across={across ?? []} reels={reels} media={media} />}
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
        <FindingsTable rows={stats.positive.slice(0, 30)} cross={cross} reels={reels} patterns={stats.patterns} media={media} />
      </Section>
      <Section title="Combinations" hint="Two features together, corrected for every pair that could have been tried.">
        <FindingsTable rows={stats.combos} cross={cross} reels={reels} patterns={stats.patterns} media={media} />
      </Section>
      <Section title="What winners avoid" hint="Clearly more common in the rest than in winners.">
        <FindingsTable rows={stats.negative.slice(0, 15)} cross={cross} reels={reels} media={media} />
      </Section>
    </div>
  );
}

export function AnalysisView({
  stats,
  briefing,
  scope,
  media,
}: {
  stats: AnalysisStats | null;
  briefing: AnalysisBriefing | null;
  scope: string;
  media: ReelMedia;
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
  const accountReels = account ? stats.reels.filter((r) => r.accountId === account.id) : [];
  const accountWinners = new Set(accountReels.filter((r) => r.cohort === "winner").map((r) => r.id));
  const across = account ? stats.all.positive.filter((f) => f.examples.some((id) => accountWinners.has(id))).slice(0, 8) : [];

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
          reels={accountReels}
          media={media}
          across={across}
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
                <Thumbs ids={[r.id]} reels={stats.reels} media={media} />
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
          media={media}
          brief={briefing ? { pattern: briefing.across_accounts.pattern, tell: briefing.across_accounts.tell_the_model } : null}
        />
      )}

      {briefing?.caveats.length ? (
        <p className="text-[11px] text-muted-foreground">⚠︎ {briefing.caveats.join(" · ")}</p>
      ) : null}
    </div>
  );
}
