"use client";

import { useState } from "react";
import { useWidth } from "@/components/pipeline/analytics/use-width";

const VIEWS = "#60a5fa";
const CLICKS = "#34d399";

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });

/** Views and clicks per day, two lines on one axis. */
export function DailyChart({ daily }: { daily: [number, number, number][] }) {
  const { ref, width: W } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const L = 32;
  const R = 10;
  const T = 10;
  const B = 24;
  const max = Math.max(1, ...daily.map((d) => Math.max(d[1], d[2])));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const x = (i: number) => L + (daily.length > 1 ? (i / (daily.length - 1)) * (W - L - R) : (W - L - R) / 2);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  // Soft curves with flat handles: no overshoot below zero.
  const line = (k: 1 | 2) =>
    daily
      .map((d, i) => {
        if (i === 0) return `M${x(0).toFixed(1)},${y(d[k]).toFixed(1)}`;
        const mx = ((x(i - 1) + x(i)) / 2).toFixed(1);
        return `C${mx},${y(daily[i - 1][k]).toFixed(1)} ${mx},${y(d[k]).toFixed(1)} ${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`;
      })
      .join(" ");
  const area = (k: 1 | 2) => `${line(k)} L${x(daily.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const ticks = [0, top / 2, top];
  const h = hover != null ? daily[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(daily.length / Math.max(2, Math.floor(W / 110))));

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          daily.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-white/[0.07]" strokeDasharray="2 4" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" className="fill-white/40">
              {v}
            </text>
          </g>
        ))}
        <defs>
          <linearGradient id="daily-views" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={VIEWS} stopOpacity="0.3" />
            <stop offset="100%" stopColor={VIEWS} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="daily-clicks" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={CLICKS} stopOpacity="0.22" />
            <stop offset="100%" stopColor={CLICKS} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area(1)} fill="url(#daily-views)" />
        <path d={area(2)} fill="url(#daily-clicks)" />
        <path d={line(1)} fill="none" stroke={VIEWS} strokeWidth="2.25" strokeLinecap="round" />
        <path d={line(2)} fill="none" stroke={CLICKS} strokeWidth="2.25" strokeLinecap="round" />
        {daily.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d[0]} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" className="fill-white/40">
              {fmtDay(d[0])}
            </text>
          ) : null
        )}
        {h && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="stroke-white/25" strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={y(h[1])} r="4.5" fill={VIEWS} stroke="white" strokeWidth="1.5" />
            <circle cx={x(hover!)} cy={y(h[2])} r="4.5" fill={CLICKS} stroke="white" strokeWidth="1.5" />
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-1 rounded-xl border border-white/15 bg-popover px-3 py-1.5 text-[11px] shadow-xl"
          style={{ left: `${Math.min(80, (x(hover!) / W) * 100 + 1)}%` }}
        >
          <div className="text-muted-foreground">{fmtDay(h[0])}</div>
          <div className="tabular-nums">
            <span className="text-blue-300">{h[1]} views</span> · <span className="text-emerald-300">{h[2]} clicks</span>
          </div>
        </div>
      )}
      <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />Views</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Clicks</span>
      </div>
    </div>
  );
}

/** When in the day people come, 24 bars, shown in the viewer's local time. */
export function HourlyChart({ hourly }: { hourly: [number, number][] }) {
  const { ref, width: W } = useWidth<HTMLDivElement>();
  const H = 140;
  const B = 18;
  const offset = -new Date().getTimezoneOffset() / 60; // UTC → local
  const local = Array.from({ length: 24 }, (_, i) => {
    const u = (((i - offset) % 24) + 24) % 24;
    return hourly[Math.round(u) % 24];
  });
  const max = Math.max(1, ...local.map((b) => b[0]));
  const peak = local.findIndex((b) => b[0] === max);
  const bw = (W - 8) / 24;
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full">
        <defs>
          <linearGradient id="hour-glass" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.42" />
            <stop offset="100%" stopColor="white" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="hour-peak" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={VIEWS} stopOpacity="1" />
            <stop offset="100%" stopColor={VIEWS} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {local.map(([v, c], i) => {
          const h = (v / max) * (H - B - 8);
          const hc = (c / max) * (H - B - 8);
          return (
            <g key={i}>
              <rect x={4 + i * bw + 2} y={8} width={Math.max(1, bw - 4)} height={H - B - 8} rx={Math.min(8, (bw - 4) / 2)} fill="white" fillOpacity="0.04" />
              <rect
                x={4 + i * bw + 2}
                y={H - B - h}
                width={Math.max(1, bw - 4)}
                height={h}
                rx={Math.min(8, (bw - 4) / 2, h / 2)}
                fill={i === peak && v > 0 ? "url(#hour-peak)" : "url(#hour-glass)"}
              >
                <title>{`${i}:00 · ${v} views · ${c} clicks`}</title>
              </rect>
              {c > 0 && (
                <rect
                  x={4 + i * bw + bw / 2 - Math.max(1, (bw - 4) / 4)}
                  y={H - B - hc}
                  width={Math.max(2, (bw - 4) / 2)}
                  height={hc}
                  rx={Math.min(4, (bw - 4) / 4, hc / 2)}
                  fill={CLICKS}
                />
              )}
              {i % 4 === 0 && (
                <text x={4 + i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize="10" className="fill-white/40">
                  {i}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
