import { CheckCircle2, Lightbulb, Radio, Scissors, Send } from "lucide-react";
import { ChangeChip, StatTile } from "@/components/ui/stat-tile";
import { SlowBoundInput } from "@/components/pipeline/slow-bound-input";
import type { WeekPoint } from "@/components/pipeline/pipeline-view";

/**
 * The pipeline dashboard in glass: five figures on top, the way the
 * accounts tab opens, and the turnaround as one card of three dials.
 */

export function PipelineTiles({
  liveAccounts,
  perDay,
  posted,
  last7,
  previous7,
  openLinks,
  toEdit,
  ready,
  readySfw,
  weeks,
}: {
  liveAccounts: number;
  perDay: number;
  posted: number;
  last7: number;
  previous7: number;
  openLinks: number;
  toEdit: number;
  ready: number;
  readySfw: number;
  weeks: WeekPoint[];
}) {
  const delta = last7 - previous7;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <StatTile
        icon={Radio}
        tone="sky"
        label="Live accounts"
        value={liveAccounts}
        change={
          <>
            <ChangeChip value={null}>{perDay}/day</ChangeChip>
            <span>reels needed</span>
          </>
        }
      />
      <StatTile
        icon={Send}
        tone="blue"
        label="Posted"
        value={posted}
        spark={weeks.map((w) => w.posted)}
        change={
          <>
            <ChangeChip value={delta === 0 ? null : delta}>
              {delta > 0 ? "+" : ""}
              {delta}
            </ChangeChip>
            <span>{last7} this week</span>
          </>
        }
      />
      <StatTile
        icon={Lightbulb}
        tone="amber"
        label="Open inspo"
        value={openLinks}
        spark={weeks.map((w) => w.shot)}
        change={<span>links waiting to be shot</span>}
      />
      <StatTile
        icon={Scissors}
        tone="violet"
        label="To edit"
        value={toEdit}
        spark={weeks.map((w) => w.edited)}
        change={<span>jobs waiting for a cut</span>}
      />
      <StatTile
        icon={CheckCircle2}
        tone="green"
        label="Ready to post"
        value={ready}
        change={
          <>
            <ChangeChip value={null}>{readySfw} SFW</ChangeChip>
            <span>cuts not posted</span>
          </>
        }
      />
    </div>
  );
}

type Leg = { key: string; label: string; days: number | null; slowDays: number; hint: string };

function fmt(days: number | null) {
  if (days === null) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

const TONE = {
  good: { text: "text-emerald-300", from: "#34d399", to: "#6ee7b7" },
  mid: { text: "text-amber-300", from: "#34d399", to: "#fbbf24" },
  slow: { text: "text-rose-300", from: "#fbbf24", to: "#fb7185" },
  none: { text: "text-white/50", from: "#ffffff", to: "#ffffff" },
};

/** One dial: the arc fills with how much of its allowed time a leg uses. */
function Dial({ leg, editable, worst }: { leg: Leg; editable: boolean; worst: boolean }) {
  const ratio = leg.days === null ? null : Math.min(leg.days / leg.slowDays, 1);
  const tone = ratio === null ? TONE.none : ratio <= 0.34 ? TONE.good : ratio <= 0.67 ? TONE.mid : TONE.slow;
  const id = `dial-${leg.key}`;
  // The knob sits where the fill ends; the arc runs from 180° to 0°.
  const a = Math.PI * (1 - (ratio ?? 0));
  const kx = 50 + 40 * Math.cos(a);
  const ky = 50 - 40 * Math.sin(a);
  return (
    <div
      className={`relative rounded-2xl border px-4 pb-3 pt-4 text-center ${
        worst ? "border-rose-300/30 bg-rose-400/[0.06]" : "border-white/10 bg-white/[0.05]"
      }`}
    >
      <div className="relative mx-auto w-full max-w-[170px]">
        <svg viewBox="0 0 100 56" className="w-full overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={tone.from} />
              <stop offset="100%" stopColor={tone.to} />
            </linearGradient>
          </defs>
          <path d="M10,50 A40,40 0 0 1 90,50" fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-white/10" />
          {ratio !== null && ratio > 0 && (
            <path
              d="M10,50 A40,40 0 0 1 90,50"
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              stroke={`url(#${id})`}
              pathLength={100}
              strokeDasharray={`${ratio * 100} 100`}
            />
          )}
          {ratio !== null && <circle cx={kx} cy={ky} r="4.5" fill="white" style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }} />}
        </svg>
        <span className={`absolute inset-x-0 bottom-0 text-2xl font-bold tabular-nums ${tone.text}`}>{fmt(leg.days)}</span>
      </div>
      <p className="mt-2 text-sm font-medium">{leg.label}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-white/45">
        of{" "}
        {editable ? <SlowBoundInput legKey={leg.key as "inspo" | "edit" | "post"} value={leg.slowDays} /> : <span>{leg.slowDays}d</span>}
      </p>
    </div>
  );
}

/** Turnaround: end to end on the left, a dial per leg beside it. */
export function SpeedDials({
  legs,
  endToEndDays,
  endToEndCount,
  editable = false,
}: {
  legs: Leg[];
  endToEndDays: number | null;
  endToEndCount: number;
  editable?: boolean;
}) {
  const measured = legs.filter((l) => l.days !== null);
  const worst =
    measured.length > 0
      ? measured.reduce((a, b) => ((b.days ?? 0) / b.slowDays > (a.days ?? 0) / a.slowDays ? b : a))
      : null;
  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-center">
        <div>
          <h2 className="text-base font-semibold">Turnaround</h2>
          <p className="text-xs text-white/55">Median, last 30 days</p>
          <p className="mt-4 text-[40px] font-bold leading-none tabular-nums">{fmt(endToEndDays)}</p>
          <p className="mt-1 text-xs text-white/55">
            link to posted{endToEndDays !== null && ` · ${endToEndCount} reels`}
          </p>
          {worst && (
            <p className="mt-3">
              <ChangeChip value={-1}>Slowest: {worst.label}</ChangeChip>
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {legs.map((l) => (
            <Dial key={l.key} leg={l} editable={editable} worst={worst?.key === l.key} />
          ))}
        </div>
      </div>
    </div>
  );
}
