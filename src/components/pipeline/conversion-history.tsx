"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useWidth } from "@/components/pipeline/analytics/use-width";
import type { FlowDay } from "@/lib/manager-dashboard";

type Key = "visit" | "click" | "fan";

const SERIES: { key: Key; label: string; color: string; dot: string }[] = [
  { key: "visit", label: "Views → landing page", color: "#60a5fa", dot: "bg-blue-400" },
  { key: "click", label: "Landing page → click", color: "#34d399", dot: "bg-emerald-400" },
  { key: "fan", label: "OF visit → fan", color: "#f472b6", dot: "bg-pink-400" },
];


/** What each rate divides, day by day. */
const PARTS: Record<Key, (d: FlowDay) => [number | null, number | null]> = {
  visit: (d) => [d.visits, d.igViews],
  click: (d) => [d.clicks, Math.max(d.visits, d.opened)],
  fan: (d) => [d.newFans, d.newFans == null ? null : d.clicks],
};

/** The rate over the seven days up to each day: single days swing too much to read. */
function rolling(flow: FlowDay[], key: Key, window: number): (number | null)[] {
  return flow.map((_, i) => {
    let n = 0;
    let d = 0;
    let seen = false;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const [a, b] = PARTS[key](flow[j]);
      if (a == null || b == null) continue;
      n += a;
      d += b;
      seen = true;
    }
    return seen && d > 0 ? n / d : null;
  });
}

const pct = (v: number) => {
  const p = v * 100;
  return p >= 10 ? `${p.toFixed(0)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
};
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The three conversions over time, as 7-day rates. One alone is drawn on
 * its own scale; together they sit on a log scale, because a rate of 0.5%
 * and one of 60% would otherwise leave one of them a flat line.
 */
export function ConversionHistory({ flow, ofConnected }: { flow: FlowDay[]; ofConnected: boolean }) {
  const [range, setRange] = useState<30 | 90>(30);
  const [only, setOnly] = useState<Key | null>(null);
  const [smooth, setSmooth] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width: W } = useWidth<HTMLDivElement>();

  const data = useMemo(() => flow.slice(-range), [flow, range]);
  const lines = useMemo(() => {
    const full = Object.fromEntries(SERIES.map((s) => [s.key, rolling(flow, s.key, smooth ? 7 : 1)])) as Record<Key, (number | null)[]>;
    return Object.fromEntries(SERIES.map((s) => [s.key, full[s.key].slice(-range)])) as Record<Key, (number | null)[]>;
  }, [flow, range, smooth]);
  const shown = SERIES.filter((s) => (only ? s.key === only : true)).filter((s) => lines[s.key].some((v) => v != null && v > 0));

  const H = 260;
  const L = 46;
  const R = 12;
  const T = 12;
  const B = 26;
  const values = shown.flatMap((s) => lines[s.key].filter((v): v is number => v != null && v > 0));
  const log = shown.length > 1;
  const maxV = Math.max(...values, 0.0001);
  const minV = Math.min(...values, maxV);
  // Log: whole decades around the data. Linear: zero to a round top.
  const lo = log ? Math.pow(10, Math.floor(Math.log10(minV))) : 0;
  const hi = log ? Math.pow(10, Math.ceil(Math.log10(maxV))) : niceTop(maxV);
  const y = (v: number) => {
    const f = log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1) : v / hi;
    return T + (1 - f) * (H - T - B);
  };
  const ticks = log
    ? Array.from({ length: Math.round(Math.log10(hi / lo)) + 1 }, (_, i) => lo * Math.pow(10, i))
    : [0, hi / 2, hi];
  const x = (i: number) => L + (data.length > 1 ? (i / (data.length - 1)) * (W - L - R) : 0);
  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null || v <= 0) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(W / 90))));
  const h = hover != null ? data[hover] : null;

  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Conversion over time</h2>
          <p className="text-xs text-white/55">
            {smooth ? "Rolling 7-day rate" : "Per day"} · {log ? "log scale" : "own scale"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Chip on={only === null} onClick={() => setOnly(null)}>All</Chip>
          {SERIES.map((s) => (
            <Chip key={s.key} on={only === s.key} onClick={() => setOnly(only === s.key ? null : s.key)}>
              <span className={cn("h-2 w-2 rounded-full", s.dot)} />
              {s.label}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-white/15" />
          <Chip on={smooth} onClick={() => setSmooth(!smooth)}>7-day</Chip>
          {([30, 90] as const).map((r) => (
            <Chip key={r} on={range === r} onClick={() => setRange(r)}>
              {r}d
            </Chip>
          ))}
        </div>
      </div>

      <div ref={ref} className="relative mt-4">
        {shown.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground">
            {only === "fan" && !ofConnected ? "OnlyFans is not connected yet." : "Nothing measured in this range yet."}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block max-w-full"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - L) / Math.max(1, W - L - R)) * (data.length - 1));
              setHover(Math.max(0, Math.min(data.length - 1, i)));
            }}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v || lo || 0)} y2={y(v || lo || 0)} className="stroke-white/[0.07]" strokeDasharray="2 4" />
                <text x={L - 6} y={y(v || lo || 0) + 3} textAnchor="end" fontSize="10" className="fill-white/40">
                  {v === 0 ? "0" : pct(v)}
                </text>
              </g>
            ))}
            {shown.map((s) => (
              <path key={s.key} d={path(lines[s.key])} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" className="fill-white/40">
                  {fmtDay(d.day)}
                </text>
              ) : null
            )}
            {hover != null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-white/25" strokeDasharray="3 3" />
                {shown.map((s) => {
                  const v = lines[s.key][hover];
                  return v != null && v > 0 ? (
                    <circle key={s.key} cx={x(hover)} cy={y(v)} r="4" fill={s.color} stroke="white" strokeWidth="1.5" />
                  ) : null;
                })}
              </>
            )}
          </svg>
        )}
        {h && hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-xl border border-white/15 bg-popover px-3 py-2 text-[11px] shadow-xl"
            style={{ left: `${Math.min(62, (x(hover) / W) * 100 + 1)}%` }}
          >
            <div className="text-muted-foreground">{fmtDay(h.day)}</div>
            {shown.map((s) => {
              const v = lines[s.key][hover];
              return (
                <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                  <span className="text-white/60">{s.label}</span>
                  <span className="ml-auto pl-3 font-semibold">{v == null ? "—" : pct(v)}</span>
                </div>
              );
            })}
            <div className="mt-1 border-t border-white/10 pt-1 text-white/55 tabular-nums">
              {h.igViews != null && <>{h.igViews.toLocaleString("de-DE")} views · </>}
              {h.visits.toLocaleString("de-DE")} visits · {h.clicks.toLocaleString("de-DE")} clicks
              {h.newFans != null && <> · {h.newFans.toLocaleString("de-DE")} fans</>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function niceTop(v: number) {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1];
  return steps.find((s) => s >= v) ?? Math.ceil(v);
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
        on ? "border-white/40 bg-white text-neutral-900" : "border-white/15 bg-white/[0.06] text-white/75 hover:bg-white/15"
      )}
    >
      {children}
    </button>
  );
}
