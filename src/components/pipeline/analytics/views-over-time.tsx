"use client";

import { useMemo, useState } from "react";
import { compact, niceStep } from "@/lib/account-analytics";
import { useWidth } from "./use-width";

type Series = { key: string; label: string; color: string; points: number[] };

/**
 * Absolute views over time — one axis, real numbers, so the question it
 * answers is "is the network growing", not "what shape does each line
 * have". Switch between the total, a platform, or one account.
 */
export function ViewsOverTime({
  days,
  series,
  periodStart,
  seams = [],
}: {
  days: number[];
  series: Series[];
  /** Start of the selected period, drawn as a marker. */
  periodStart: number;
  /** Indices after which the readings come from a different source. */
  seams?: number[];
}) {
  const [active, setActive] = useState(series[0]?.key ?? "");
  const [hover, setHover] = useState<number | null>(null);
  const s = series.find((x) => x.key === active) ?? series[0];
  const { ref, width: W } = useWidth<HTMLDivElement>();

  const H = 240;
  const L = 44;
  const R = 12;
  const T = 12;
  const B = 28;

  const geometry = useMemo(() => {
    if (!s || days.length === 0) return null;
    const maxY = Math.max(1, ...s.points);
    // A tidy top: round the axis up to a clean number above the peak.
    const step = niceStep(maxY, 5);
    const top = Math.ceil(maxY / step) * step;
    const minX = days[0];
    const maxX = days[days.length - 1];
    const spanX = Math.max(1, maxX - minX);
    const x = (t: number) => L + ((t - minX) / spanX) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const pts = days.map((t, i) => ({ x: x(t), y: y(s.points[i]), t, v: s.points[i] }));
    const ticks: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { pts, ticks, x, y, top, minX, maxX };
  }, [s, days, W]);

  if (!s || !geometry || days.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground">
        Not enough readings yet — a line needs two days.
      </div>
    );
  }

  const { pts, ticks, x, top, minX, maxX } = geometry;
  // One segment per source. The seam is a change of basis, not a move,
  // so the segments are not joined, and the older one is drawn lighter.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  pts.forEach((p, i) => {
    current.push(p);
    if (seams.includes(i)) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  const pathOf = (seg: { x: number; y: number }[]) =>
    seg.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaOf = (seg: { x: number; y: number }[]) =>
    `${pathOf(seg)} L${seg[seg.length - 1].x.toFixed(1)},${H - B} L${seg[0].x.toFixed(1)},${H - B} Z`;
  const hovered = hover != null ? pts[hover] : null;
  // Points sit at the end of a UTC day; named in UTC so 23:59Z stays that day.
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });
  const nf = new Intl.NumberFormat("de-DE");

  // Month ticks along the bottom, at most six.
  const xTicks: number[] = [];
  const stepX = Math.max(1, Math.round(days.length / Math.max(2, Math.floor(W / 130))));
  for (let i = 0; i < days.length; i += stepX) xTicks.push(days[i]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {series.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setActive(opt.key)}
            className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
              opt.key === active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
              style={{ background: opt.color }}
            />
            {opt.label}
          </button>
        ))}
      </div>

      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block max-w-full"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            let best = 0;
            let bestD = Infinity;
            pts.forEach((p, i) => {
              const dd = Math.abs(p.x - px);
              if (dd < bestD) {
                bestD = dd;
                best = i;
              }
            });
            setHover(best);
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={L}
                x2={W - R}
                y1={geometry.y(v)}
                y2={geometry.y(v)}
                className="stroke-border/50"
                strokeWidth="1"
              />
              <text
                x={L - 8}
                y={geometry.y(v) + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {compact(v)}
              </text>
            </g>
          ))}
          {periodStart > minX && periodStart < maxX && (
            <line
              x1={x(periodStart)}
              x2={x(periodStart)}
              y1={T}
              y2={H - B}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          {segments.map((seg, i) => {
            const last = i === segments.length - 1;
            return (
              <g key={i}>
                <path d={areaOf(seg)} fill={s.color} fillOpacity={last ? 0.08 : 0.04} />
                <path
                  d={pathOf(seg)}
                  fill="none"
                  stroke={s.color}
                  strokeOpacity={last ? 1 : 0.55}
                  strokeWidth="2"
                  strokeDasharray={last ? undefined : "4 3"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {hovered && (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={T}
                y2={H - B}
                className="stroke-foreground/30"
                strokeWidth="1"
              />
              <circle cx={hovered.x} cy={hovered.y} r="4" fill={s.color} />
            </>
          )}
          {xTicks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {fmtDate(t)}
            </text>
          ))}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] shadow"
            style={{
              left: `${Math.min(88, Math.max(0, (hovered.x / W) * 100))}%`,
              transform: hovered.x / W > 0.7 ? "translateX(-100%)" : undefined,
            }}
          >
            <div className="text-muted-foreground">{fmtDate(hovered.t)}</div>
            <div className="font-semibold tabular-nums">{nf.format(hovered.v)} views</div>
          </div>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Cumulative views, latest reading per reel and day · axis top {compact(top)}
        {segments.length > 1 &&
          " · dotted: read off screenshots, the latest grid only; solid: scraped, every reel the account has"}
      </p>
    </div>
  );
}
