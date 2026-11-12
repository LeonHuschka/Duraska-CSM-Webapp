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
import { BarChart3, Eye, Film, Heart, Users, type LucideIcon } from "lucide-react";
import { ChangeChip, StatTile, type Tone } from "@/components/ui/stat-tile";

const nf = new Intl.NumberFormat("de-DE");

export function PeriodSelector({ period }: { period: PeriodKey }) {
  return (
    <div className="glass-pill flex gap-1 rounded-full p-1">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`/?tab=accounts&period=${p.key}`}
          scroll={false}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all ${
            p.key === period
              ? "bg-white text-neutral-900 shadow-[0_4px_14px_-4px_rgba(255,255,255,0.5)]"
              : "text-white/70 hover:bg-white/15 hover:text-white"
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

const KPI_LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  views: { icon: Eye, tone: "blue" },
  followers: { icon: Users, tone: "green" },
  avg: { icon: BarChart3, tone: "amber" },
  reels: { icon: Film, tone: "violet" },
  engagement: { icon: Heart, tone: "rose" },
};

function pct(v: number): string {
  return `${Math.abs(v * 100).toFixed(Math.abs(v * 100) >= 100 ? 0 : 1)}%`;
}

/** The five numbers that say how the network is doing, with what moved. */
export function KpiRow({
  kpis,
  hasPeriod,
  spark = {},
}: {
  kpis: Kpi[];
  hasPeriod: boolean;
  /** A history per figure, where there is one, drawn as a small curve. */
  spark?: Record<string, number[]>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k) => {
        // Total views and followers are stocks: headline is the total, the
        // change line is the gain in the period. The others are the
        // period's own figure, compared with the period before.
        const stock = k.delta != null;
        const gainChange = stock ? change(k.delta, k.deltaPrev) : change(k.value, k.deltaPrev);
        const look = KPI_LOOK[k.key] ?? { icon: BarChart3, tone: "sky" as Tone };
        return (
          <StatTile
            key={k.key}
            icon={look.icon}
            tone={look.tone}
            label={k.label}
            value={fmt(k.value, k.format)}
            spark={spark[k.key]}
            change={
              hasPeriod ? (
                <>
                  {stock ? (
                    <ChangeChip value={k.delta}>
                      {k.delta! > 0 ? "+" : ""}
                      {fmt(k.delta, k.deltaFormat)}
                    </ChangeChip>
                  ) : (
                    <ChangeChip value={gainChange}>{gainChange == null ? "—" : pct(gainChange)}</ChangeChip>
                  )}
                  <span>
                    {stock
                      ? gainChange != null
                        ? `${gainChange > 0 ? "+" : gainChange < 0 ? "−" : ""}${pct(gainChange)} vs previous`
                        : "in period"
                      : "vs previous"}
                  </span>
                </>
              ) : (
                <span>{k.hint}</span>
              )
            }
          />
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
