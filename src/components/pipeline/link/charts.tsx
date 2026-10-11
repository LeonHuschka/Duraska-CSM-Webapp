"use client";

import { useState } from "react";
import { useWidth } from "@/components/pipeline/analytics/use-width";

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
  const line = (k: 1 | 2) => daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
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
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border/50" strokeDasharray="3 3" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" className="fill-muted-foreground">
              {v}
            </text>
          </g>
        ))}
        <path d={line(1)} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" />
        <path d={line(2)} fill="none" stroke="#f472b6" strokeWidth="2" strokeLinejoin="round" />
        {daily.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d[0]} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
              {fmtDay(d[0])}
            </text>
          ) : null
        )}
        {h && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="stroke-foreground/30" />
            <circle cx={x(hover!)} cy={y(h[1])} r="3.5" fill="#a78bfa" />
            <circle cx={x(hover!)} cy={y(h[2])} r="3.5" fill="#f472b6" />
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] shadow"
          style={{ left: `${Math.min(80, (x(hover!) / W) * 100 + 1)}%` }}
        >
          <div className="text-muted-foreground">{fmtDay(h[0])}</div>
          <div className="tabular-nums">
            <span className="text-violet-400">{h[1]} views</span> · <span className="text-pink-400">{h[2]} clicks</span>
          </div>
        </div>
      )}
      <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" />Views</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-400" />Clicks</span>
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
  const bw = (W - 8) / 24;
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full">
        {local.map(([v, c], i) => {
          const h = (v / max) * (H - B - 8);
          const hc = (c / max) * (H - B - 8);
          return (
            <g key={i}>
              <rect x={4 + i * bw + 1} y={H - B - h} width={bw - 2} height={h} rx="2" fill="#a78bfa" opacity="0.8">
                <title>{`${i}:00 · ${v} views · ${c} clicks`}</title>
              </rect>
              {c > 0 && <rect x={4 + i * bw + 1} y={H - B - hc} width={bw - 2} height={hc} rx="2" fill="#f472b6" />}
              {i % 4 === 0 && (
                <text x={4 + i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
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
