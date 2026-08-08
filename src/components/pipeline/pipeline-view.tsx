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
