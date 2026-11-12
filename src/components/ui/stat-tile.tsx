import { ArrowUpRight, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A number on glass, as in the glass dashboards: a tinted icon tile and a
 * corner arrow on top, the label, the figure, then a change chip and —
 * where there is a history — a small curve on the right.
 */

export type Tone = "blue" | "green" | "amber" | "violet" | "rose" | "sky";

const TONES: Record<Tone, { tile: string; spark: string }> = {
  blue: { tile: "from-blue-400/45 to-blue-600/20", spark: "#60a5fa" },
  green: { tile: "from-emerald-400/45 to-emerald-600/20", spark: "#34d399" },
  amber: { tile: "from-amber-300/50 to-amber-600/20", spark: "#fbbf24" },
  violet: { tile: "from-violet-400/45 to-violet-600/20", spark: "#a78bfa" },
  rose: { tile: "from-rose-400/45 to-rose-600/20", spark: "#fb7185" },
  sky: { tile: "from-sky-300/45 to-sky-600/20", spark: "#7dd3fc" },
};

export function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-white/20",
        TONES[tone].tile,
        className
      )}
    >
      <Icon className="h-4 w-4 text-white" />
    </span>
  );
}

/** Up green, down red, flat grey — a pill, not a line of text. */
export function ChangeChip({ value, children }: { value: number | null; children: React.ReactNode }) {
  const flat = value == null || Math.abs(value) < 0.0005;
  const up = !flat && value! > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        flat ? "bg-white/10 text-white/70" : up ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"
      )}
    >
      {!flat && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** A soft curve with a fading fill under it. */
export function Sparkline({ points, tone, className }: { points: number[]; tone: Tone; className?: string }) {
  const pts = points.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const W = 96;
  const H = 36;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 8)] as const);
  // Smooth the corners: each segment a cubic through the midpoints.
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  const color = TONES[tone].spark;
  const id = `sp-${tone}-${pts.length}-${Math.round(pts[pts.length - 1])}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-9 w-24 overflow-visible", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTile({
  icon,
  tone,
  label,
  value,
  change,
  spark,
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: React.ReactNode;
  /** The line under the figure: a chip and a few words. */
  change?: React.ReactNode;
  spark?: number[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/50 bg-card p-4", className)}>
      <div className="flex items-start justify-between">
        <IconTile icon={icon} tone={tone} />
        <ArrowUpRight className="h-4 w-4 text-white/40" />
      </div>
      <p className="mt-3 text-xs text-white/60">{label}</p>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <p className="text-[26px] font-bold leading-tight tabular-nums text-white">{value}</p>
        {spark && <Sparkline points={spark} tone={tone} className="mb-1 shrink-0" />}
      </div>
      {change && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/55">{change}</div>}
    </div>
  );
}
