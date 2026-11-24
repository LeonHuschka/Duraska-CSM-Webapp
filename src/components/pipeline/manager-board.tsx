import {
  CheckCircle2,
  Coins,
  Eye,
  Heart,
  Lightbulb,
  MousePointerClick,
  PackageOpen,
  Radio,
  Scissors,
  Send,
  Sparkles,
  Users,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ChangeChip, IconTile, Sparkline, StatTile, type Tone } from "@/components/ui/stat-tile";
import { compact } from "@/lib/account-analytics";
import type { Conversion, ManagerData } from "@/lib/manager-dashboard";

const nf = new Intl.NumberFormat("de-DE");
const eur = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const pct = (v: number | null) => {
  if (v == null) return "—";
  const p = v * 100;
  return p >= 10 ? `${p.toFixed(1)}%` : p >= 1 ? `${p.toFixed(2)}%` : `${p.toFixed(3)}%`;
};
const rel = (now: number | null, prev: number | null) => (now != null && prev != null && prev > 0 ? (now - prev) / prev : null);
const sign = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

const CONV: Record<Conversion["key"], { icon: LucideIcon; tone: Tone }> = {
  visit: { icon: Eye, tone: "blue" },
  click: { icon: MousePointerClick, tone: "green" },
  fan: { icon: Heart, tone: "rose" },
};

/** The chain from a reel's views to a fan, one card per step, last 7 days. */
export function ConversionRow({ conversions, of }: { conversions: Conversion[]; of: ManagerData["of"] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {conversions.map((c) => {
        const missing = c.key === "fan" && !of.found;
        const change = rel(c.rate, c.prev);
        const { icon, tone } = CONV[c.key];
        return (
          <div key={c.key} className="rounded-2xl border border-border/50 bg-card p-4">
            <div className="flex items-start justify-between">
              <IconTile icon={icon} tone={tone} />
              <span className="text-[10px] uppercase tracking-wide text-white/40">last 7 days</span>
            </div>
            <p className="mt-3 text-xs text-white/60">{c.label}</p>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <p className="text-[30px] font-bold leading-tight tabular-nums text-white">{missing ? "—" : pct(c.rate)}</p>
              {!missing && <Sparkline points={c.spark} tone={tone} className="mb-1 h-10 w-28 shrink-0" />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/55">
              {missing ? (
                <span>{of.connected ? "OnlyFans account not found in OnlyMonster" : "Connect OnlyMonster to see fans"}</span>
              ) : (
                <>
                  {change != null && <ChangeChip value={change}>{sign(change)}</ChangeChip>}
                  <span className="tabular-nums">
                    {nf.format(c.num)} {c.to} of {compact(c.den)} {c.from}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Every stock, with the line it drew over the last 30 days. */
export function TotalsGrid({ d }: { d: ManagerData }) {
  const t = d.totals;
  const tiles: { key: string; icon: LucideIcon; tone: Tone; label: string; value: string; note?: string; spark: number[] }[] = [
    { key: "live", icon: Radio, tone: "sky", label: "Live accounts", value: fmt(t.live.value), note: `${t.live.note} · ${d.extras.perDay}/day needed`, spark: t.live.spark },
    { key: "posted", icon: Send, tone: "blue", label: "Posted reels", value: fmt(t.posted.value), note: "posts across all accounts", spark: t.posted.spark },
    { key: "inspo", icon: Lightbulb, tone: "amber", label: "Open inspo", value: fmt(t.inspo.value), note: "links waiting to be shot", spark: t.inspo.spark },
    { key: "edit", icon: Scissors, tone: "violet", label: "To edit", value: fmt(t.toEdit.value), note: "jobs waiting for a cut", spark: t.toEdit.spark },
    { key: "ready", icon: CheckCircle2, tone: "green", label: "Ready to post · new", value: fmt(t.ready.value), note: `reels not run anywhere · ${t.ready.note}`, spark: t.ready.spark },
    { key: "views", icon: Eye, tone: "rose", label: "Total views", value: t.views.value == null ? "—" : compact(t.views.value), note: "posting accounts, all reels", spark: t.views.spark },
    { key: "followers", icon: Users, tone: "sky", label: "Total followers", value: fmt(t.followers.value), note: "posting accounts", spark: t.followers.spark },
    {
      key: "fans",
      icon: UserPlus,
      tone: "rose",
      label: "OnlyFans fans",
      value: fmt(t.fans.value),
      note: d.of.found ? "active in 12 months · line: new in 30 days" : d.of.connected ? "account not found" : "not connected yet",
      spark: t.fans.spark,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((x) => (
        <StatTile
          key={x.key}
          icon={x.icon}
          tone={x.tone}
          label={x.label}
          value={x.value}
          spark={x.spark.length > 1 ? x.spark : undefined}
          change={x.note ? <span>{x.note}</span> : undefined}
        />
      ))}
    </div>
  );
}

/** The figures that do not fit a stock: runway, money, and reach per post. */
export function ExtrasRow({ d }: { d: ManagerData }) {
  const e = d.extras;
  const revChange = rel(e.revenue7, e.revenuePrev7);
  const vppChange = rel(e.viewsPerPost7, e.viewsPerPostPrev7);
  const items: { icon: LucideIcon; tone: Tone; label: string; value: string; note: React.ReactNode }[] = [
    {
      icon: PackageOpen,
      tone: e.bufferDays != null && e.bufferDays < 3 ? "rose" : "green",
      label: "Buffer",
      value: e.bufferDays == null ? "—" : `${e.bufferDays.toFixed(1)} days`,
      note: <span>fresh cuts at {e.perDay} posts a day</span>,
    },
    {
      icon: Sparkles,
      tone: "violet",
      label: "Views per post",
      value: e.viewsPerPost7 == null ? "—" : compact(Math.round(e.viewsPerPost7)),
      note: (
        <>
          {vppChange != null && <ChangeChip value={vppChange}>{sign(vppChange)}</ChangeChip>}
          <span>views gained ÷ posts, 7 days</span>
        </>
      ),
    },
    {
      icon: Wallet,
      tone: "amber",
      label: "OnlyFans revenue",
      value: e.revenue7 == null ? "—" : eur.format(e.revenue7),
      note: e.revenue7 == null ? (
        <span>{d.of.connected ? "account not found" : "not connected yet"}</span>
      ) : (
        <>
          {revChange != null && <ChangeChip value={revChange}>{sign(revChange)}</ChangeChip>}
          <span>net, 7 days</span>
        </>
      ),
    },
    {
      icon: Coins,
      tone: "green",
      label: "Fan → spender",
      value: pct(e.fanToSpender7),
      note:
        e.newSpenders7 == null ? (
          <span>{d.of.connected ? "account not found" : "not connected yet"}</span>
        ) : (
          <span>
            {nf.format(e.newSpenders7)} new spenders
            {e.revenuePerClick7 != null && ` · ${eur.format(e.revenuePerClick7 * 100)} per 100 clicks`}
          </span>
        ),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((x) => (
        <StatTile key={x.label} icon={x.icon} tone={x.tone} label={x.label} value={x.value} change={x.note} />
      ))}
    </div>
  );
}

function fmt(v: number | null) {
  return v == null ? "—" : nf.format(Math.round(v));
}
