/**
 * Dependency-free SVG donut for the content pipeline.
 *
 * Server-rendered — it's a static picture, so there's no reason to ship a
 * charting library to the phone for it.
 */

export interface Segment {
  label: string;
  value: number;
  /** tailwind text-* colour class, used for both arc and legend dot */
  color: string;
  hint?: string;
}

export function PipelineDonut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Segment[];
  centerLabel: string;
  centerValue: number | string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;

  // Walk the circle, giving each segment its share of the circumference.
  let offset = 0;
  const arcs = segments.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const len = frac * C;
    const arc = { ...s, len, gap: C - len, offset };
    offset += len;
    return arc;
  });

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="12"
            className="stroke-muted"
          />
          {total > 0 &&
            arcs.map((a) =>
              a.len <= 0 ? null : (
                <circle
                  key={a.label}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  strokeWidth="12"
                  strokeDasharray={`${a.len} ${a.gap}`}
                  strokeDashoffset={-a.offset}
                  className={a.color}
                />
              )
            )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{centerValue}</span>
          <span className="text-[10px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.color.replace("stroke-", "bg-")}`}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {s.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Weekly goal ring — how much of the week's minimum she has shot already.
 * The minimum is driven by how many accounts are live, since a reel can
 * only be posted once.
 */
export function WeeklyGoal({
  done,
  target,
  liveAccounts,
}: {
  done: number;
  target: number;
  liveAccounts: number;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  const filled = (pct / 100) * C;

  const tone =
    pct >= 100
      ? "stroke-emerald-400"
      : pct >= 60
        ? "stroke-primary"
        : pct >= 30
          ? "stroke-amber-400"
          : "stroke-rose-400";

  const message =
    pct >= 100
      ? "Week complete — you crushed it 🎉"
      : `${Math.max(0, target - done)} more to hit this week's minimum`;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 110 110" className="h-28 w-28 -rotate-90">
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              strokeWidth="10"
              className="stroke-muted"
            />
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              className={`${tone} transition-all`}
              strokeDasharray={`${filled} ${C - filled}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
            <span className="text-[10px] text-muted-foreground">this week</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            <span className="text-xl font-semibold tabular-nums">{done}</span>
            <span className="text-muted-foreground"> / {target} reels</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            Based on {liveAccounts} live account{liveAccounts === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Tiny bar chart for "what did I do the last 7 days". */
export function WeekBars({
  days,
}: {
  days: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="flex items-end justify-between gap-1.5">
      {days.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[9px] tabular-nums text-muted-foreground">
            {d.value > 0 ? d.value : ""}
          </span>
          <div
            className={`w-full rounded-t ${d.value > 0 ? "bg-primary" : "bg-muted"}`}
            style={{ height: `${Math.max(3, (d.value / max) * 44)}px` }}
          />
          <span className="text-[9px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
