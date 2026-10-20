import Link from "next/link";
import {
  PERIODS,
  change,
  compact,
  type AccountStats,
  type Kpi,
  type PeriodKey,
} from "@/lib/account-analytics";
import { AccountAvatar } from "@/components/pipeline/account-avatar";

const nf = new Intl.NumberFormat("de-DE");

export function PeriodSelector({ period }: { period: PeriodKey }) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`/?tab=accounts&period=${p.key}`}
          scroll={false}
          className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
            p.key === period
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}

function Delta({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.0005;
  return (
    <span
      className={
        flat || muted ? "text-muted-foreground" : up ? "text-emerald-400" : "text-rose-400"
      }
    >
      {flat ? "" : up ? "▲ " : "▼ "}
      {Math.abs(value * 100).toFixed(value * 100 >= 100 ? 0 : 1)}%
    </span>
  );
}

function fmt(v: number | null, f: "int" | "pct" | "x"): string {
  if (v == null) return "—";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "x") return `${v.toFixed(1)}×`;
  return nf.format(Math.round(v));
}

/** The five numbers that say how the network is doing, with what moved. */
export function KpiRow({ kpis, hasPeriod }: { kpis: Kpi[]; hasPeriod: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k) => {
        // Total views and followers are stocks: headline is the total, the
        // change line is the gain in the period. The others are the
        // period's own figure, compared with the period before.
        const stock = k.delta != null;
        const gainChange = stock ? change(k.delta, k.deltaPrev) : change(k.value, k.deltaPrev);
        return (
          <div key={k.key} className="rounded-2xl border border-border/50 bg-card p-4">
            <p className="text-[11px] text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(k.value, k.format)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums [&>span]:whitespace-nowrap">
              {hasPeriod ? (
                <>
                  {stock && (
                    <span className={k.delta! > 0 ? "text-emerald-400" : k.delta! < 0 ? "text-rose-400" : "text-muted-foreground"}>
                      {k.delta! > 0 ? "+" : ""}
                      {fmt(k.delta, k.deltaFormat)}
                    </span>
                  )}
                  {(gainChange != null || !stock) && <Delta value={gainChange} />}
                  <span className="text-muted-foreground">
                    {stock ? "in period" : "vs previous"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{k.hint}</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Ranked by views in the period, with a bar so the gap is visible. */
export function PerformanceList({ accounts, hasPeriod }: { accounts: AccountStats[]; hasPeriod: boolean }) {
  const top = Math.max(1, ...accounts.map((a) => a.views));
  return (
    <ul className="space-y-2.5">
      {accounts.map((a, i) => {
        const delta = change(a.views, a.viewsPrev);
        return (
          <li key={a.id}>
            <a
              href={`#account-${a.id}`}
              className="group flex items-center gap-3 text-xs"
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
              <AccountAvatar src={a.avatar} platform={a.platform} label={a.label} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium group-hover:underline">{a.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {compact(a.views)}
                    {hasPeriod && (
                      <span className="ml-2">
                        <Delta value={delta} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(a.views / top) * 100}%`, background: a.color }}
                  />
                </span>
              </span>
            </a>
          </li>
        );
      })}
      {accounts.length === 0 && <li className="text-xs text-muted-foreground">No posting accounts.</li>}
    </ul>
  );
}

/** Interaction, kept apart from reach: a small account can win here. */
export function EngagementSection({ accounts, hasPeriod }: { accounts: AccountStats[]; hasPeriod: boolean }) {
  const known = accounts.filter((a) => a.engagementRate != null).sort((a, b) => b.engagementRate! - a.engagementRate!);
  const top = Math.max(0.0001, ...known.map((a) => a.engagementRate!));
  const totals = accounts.reduce(
    (t, a) => ({ likes: t.likes + a.likes, comments: t.comments + a.comments, shares: t.shares + a.shares }),
    { likes: 0, comments: 0, shares: 0 }
  );
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_auto]">
      <ul className="space-y-2.5">
        {known.map((a) => (
          <li key={a.id} className="flex items-center gap-3 text-xs">
            <AccountAvatar src={a.avatar} platform={a.platform} label={a.label} size={24} />
            <span className="w-32 shrink-0 truncate font-medium">{a.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(a.engagementRate! / top) * 100}%`, background: a.color }}
              />
            </span>
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">
              {(a.engagementRate! * 100).toFixed(1)}%
            </span>
            {hasPeriod && (
              <span className="w-14 shrink-0 text-right tabular-nums">
                <Delta value={change(a.engagementRate, a.engagementRatePrev)} />
              </span>
            )}
          </li>
        ))}
        {known.length === 0 && (
          <li className="text-xs text-muted-foreground">
            No likes, comments or shares read in this period yet.
          </li>
        )}
      </ul>
      <div className="flex gap-6 text-xs md:flex-col md:gap-3 md:border-l md:border-border/40 md:pl-6">
        {[
          ["♥ Likes", totals.likes],
          ["💬 Comments", totals.comments],
          ["↗ Shares", totals.shares],
        ].map(([l, v]) => (
          <div key={l as string}>
            <p className="text-base font-semibold tabular-nums">{nf.format(v as number)}</p>
            <p className="text-[11px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
