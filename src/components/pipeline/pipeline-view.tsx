import { PlatformBadges } from "@/components/dashboard/pipeline-donut";
import { SlowBoundInput } from "@/components/pipeline/slow-bound-input";

/**
 * Manager's view of the pipeline: where the work sits, how fast it moves
 * through, and which stage is holding everything up.
 *
 * Server-rendered — every number is derived on the server and the charts
 * are plain SVG/divs, so nothing about this page costs egress or ships a
 * charting library to a phone.
 */

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export interface Stage {
  label: string;
  value: number;
  tone: string;
  note: string;
}

/** Where everything is right now, as a proportional bar. */
export function StageFunnel({ stages }: { stages: Stage[] }) {
  const total = Math.max(1, stages.reduce((a, s) => a + s.value, 0));
  return (
    <Card
      title="Where the work sits"
      hint="Every reel in flight, by the stage it is waiting in"
    >
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {stages.map((s) => (
          <div
            key={s.label}
            className={s.tone}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-sm ${s.tone.replace("bg-", "bg-")}`}
              />
              <span className="text-lg font-semibold tabular-nums">{s.value}</span>
            </div>
            <p className="text-xs font-medium">{s.label}</p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {s.note}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export interface WeekPoint {
  label: string;
  shot: number;
  edited: number;
  posted: number;
}

/** Throughput per week — is the machine keeping up with itself? */
export function ThroughputChart({ weeks }: { weeks: WeekPoint[] }) {
  const max = Math.max(
    1,
    ...weeks.flatMap((w) => [w.shot, w.edited, w.posted])
  );
  const series = [
    { key: "shot" as const, label: "Shot", tone: "bg-purple-400" },
    { key: "edited" as const, label: "Edited", tone: "bg-emerald-400" },
    { key: "posted" as const, label: "Posted", tone: "bg-blue-400" },
  ];
  return (
    <Card
      title="Throughput per week"
      hint="Shot, cut and posted — if posted outruns shot, the buffer is draining"
    >
      <div className="flex items-end justify-between gap-2">
        {weeks.map((w) => (
          <div key={w.label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-28 w-full items-end justify-center gap-0.5">
              {series.map((s) => {
                const v = w[s.key];
                return (
                  <div
                    key={s.key}
                    className={`w-full rounded-t ${v > 0 ? s.tone : "bg-muted"}`}
                    style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 2)}%` }}
                    title={`${s.label}: ${v}`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] text-muted-foreground">{w.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2 w-2 rounded-sm ${s.tone}`} />
            <span className="text-muted-foreground">{s.label}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

export interface Duration {
  label: string;
  median: number | null;
  slowest: number | null;
  hint: string;
}

/** How long a reel spends in each stage — the honest answer to "where is the delay". */
export function StageDurations({ durations }: { durations: Duration[] }) {
  const fmt = (h: number | null) => {
    if (h === null) return "—";
    if (h < 24) return `${Math.round(h)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };
  return (
    <Card
      title="Time per stage"
      hint="Median across the last 30 days, and the single worst case"
    >
      <div className="space-y-3">
        {durations.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{d.label}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {d.hint}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold tabular-nums">
                {fmt(d.median)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                worst {fmt(d.slowest)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The specific items that have been waiting longest — names, not averages. */
export function OldestWaiting({
  items,
}: {
  items: { id: string; title: string; days: number; stage: string }[];
}) {
  return (
    <Card
      title="Waiting the longest"
      hint="An average hides the one reel that has been stuck for three weeks"
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is sitting around — the queue is clean.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {i.stage}
              </span>
              <span
                className={`shrink-0 text-sm font-semibold tabular-nums ${
                  i.days >= 14
                    ? "text-rose-400"
                    : i.days >= 7
                      ? "text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {i.days}d
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


/** Live accounts, split by platform, with the platform marks in the middle. */
export function AccountsPie({
  counts,
  postsPerDay,
}: {
  counts: { platform: string; count: number }[];
  postsPerDay: number;
}) {
  const total = counts.reduce((a, c) => a + c.count, 0);
  const TONE: Record<string, string> = {
    instagram: "stroke-rose-400",
    facebook: "stroke-blue-400",
    tiktok: "stroke-neutral-300",
    x: "stroke-neutral-500",
  };
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = counts.map((c) => {
    const len = total > 0 ? (c.count / total) * C : 0;
    const arc = { ...c, len, gap: C - len, offset };
    offset += len;
    return arc;
  });

  return (
    <Card title="Live accounts" hint={`${postsPerDay} posts a day on each`}>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="12" className="stroke-muted" />
            {arcs.map((a) =>
              a.len <= 0 ? null : (
                <circle
                  key={a.platform}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  strokeWidth="12"
                  strokeDasharray={`${a.len} ${a.gap}`}
                  strokeDashoffset={-a.offset}
                  className={TONE[a.platform] ?? "stroke-muted-foreground"}
                />
              )
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <PlatformBadges counts={counts} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-semibold tabular-nums">{total}</p>
          <p className="text-xs text-muted-foreground">
            {total * postsPerDay} reels needed a day
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Everything that has gone out, and whether the pace is picking up. */
export function PostedCard({
  total,
  last7,
  previous7,
}: {
  total: number;
  last7: number;
  previous7: number;
}) {
  const delta = last7 - previous7;
  return (
    <Card title="Posted" hint="Reels that have gone out, all time">
      <p className="text-4xl font-semibold tabular-nums">{total}</p>
      <div className="mt-2 flex items-baseline gap-2 text-xs">
        <span className="tabular-nums">{last7} in the last 7 days</span>
        {previous7 > 0 || last7 > 0 ? (
          <span
            className={
              delta > 0
                ? "text-emerald-400"
                : delta < 0
                  ? "text-rose-400"
                  : "text-muted-foreground"
            }
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}
            {delta !== 0 && ` ${Math.abs(delta)}`} vs the 7 before
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * How long each leg takes, and which one is holding everything up.
 *
 * The scale runs the way the work does: slow on the left, zero on the
 * right, so a marker further right is unambiguously better. There is no
 * natural maximum for "days in a stage", so each leg carries its own — what
 * counts as unacceptably slow — and that bound is editable in place,
 * because only the person running the operation knows it.
 */
export function StageGauges({
  legs,
  endToEndDays,
  endToEndCount,
  editable = false,
}: {
  legs: {
    key: string;
    label: string;
    days: number | null;
    slowDays: number;
    hint: string;
  }[];
  endToEndDays: number | null;
  endToEndCount: number;
  editable?: boolean;
}) {
  const measured = legs.filter((l) => l.days !== null);
  // Worst relative to its own bound, not in absolute days — five days on a
  // leg allowed fourteen is healthier than two on a leg allowed one.
  const worst =
    measured.length > 0
      ? measured.reduce((a, b) =>
          (b.days ?? 0) / b.slowDays > (a.days ?? 0) / a.slowDays ? b : a
        )
      : null;

  return (
    <Card
      title="How fast we turn things around"
      hint="Median over the last 30 days. Left is as slow as it should ever get, right is instant."
    >
      <div className="mb-5 flex items-baseline gap-3 border-b border-border/40 pb-4">
        <span className="text-3xl font-semibold tabular-nums">
          {fmtDuration(endToEndDays)}
        </span>
        <span className="text-xs text-muted-foreground">
          {endToEndDays === null
            ? "no reel has run from link to posted yet"
            : `end to end, across ${endToEndCount} reel${endToEndCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {legs.map((l) => (
          <Gauge key={l.key} leg={l} editable={editable} />
        ))}
      </div>

      <p className="mt-5 rounded-lg bg-muted/40 px-3 py-2 text-xs">
        {worst ? (
          <>
            <span className="font-medium">Biggest bottleneck: {worst.label}</span>
            <span className="text-muted-foreground">
              {" "}
              — {fmtDuration(worst.days)} of an allowed {worst.slowDays}d.
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Nothing finished a full leg in the last 30 days yet.
          </span>
        )}
      </p>
    </Card>
  );
}

function fmtDuration(days: number | null) {
  if (days === null) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

function Gauge({
  leg,
  editable,
}: {
  leg: { key: string; label: string; days: number | null; slowDays: number; hint: string };
  editable: boolean;
}) {
  // 0 sits on the right, the slow bound on the left. Anything past the
  // bound pins to the left rather than running off the dial.
  const ratio = leg.days === null ? null : Math.min(leg.days / leg.slowDays, 1);
  const tone =
    ratio === null
      ? "text-muted-foreground"
      : ratio <= 0.34
        ? "text-emerald-400"
        : ratio <= 0.67
          ? "text-amber-400"
          : "text-rose-400";

  // Left end = 180°, right end = 0°.
  const angle = ratio === null ? null : Math.PI * ratio;
  const cx = 50 + 40 * Math.cos(angle ?? 0) * -1;
  const cy = 50 - 40 * Math.sin(angle ?? 0);

  return (
    <div className="text-center">
      <div className="relative mx-auto h-16 w-32">
        <svg viewBox="0 0 100 56" className="h-full w-full">
          <path
            d="M10,50 A40,40 0 0 1 90,50"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className="stroke-muted"
          />
          {ratio !== null && (
            <circle cx={cx} cy={cy} r="5.5" className={`${tone} fill-current`} />
          )}
        </svg>
        <span
          className={`absolute inset-x-0 bottom-0 text-lg font-semibold tabular-nums ${tone}`}
        >
          {fmtDuration(leg.days)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        {editable ? (
          <SlowBoundInput legKey={leg.key as "inspo" | "edit" | "post"} value={leg.slowDays} />
        ) : (
          <span>{leg.slowDays}d</span>
        )}
        <span>0h</span>
      </div>

      <p className="mt-1 text-xs font-medium">{leg.label}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{leg.hint}</p>
    </div>
  );
}
