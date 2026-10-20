"use client";

import { useMemo, useState } from "react";
import { compact, niceStep } from "@/lib/account-analytics";
import { AccountAvatar } from "@/components/pipeline/account-avatar";
import { useWidth } from "./use-width";

export type AccountLine = {
  id: string;
  label: string;
  platform: string;
  color: string;
  avatar: string | null;
  points: number[];
  /** Last screenshot-era index (-1 if none); first and last own reading. */
  seam: number;
  first: number;
  last: number;
};

/**
 * Views over time, one line per account on one axis, so the accounts can
 * be compared with each other. Each line runs only between the account's
 * first and last reading — an account nobody can read any more stops
 * where its numbers stop. Click a name to hide or show its line.
 */
export function ViewsOverTime({
  days,
  lines,
  periodStart,
}: {
  days: number[];
  lines: AccountLine[];
  periodStart: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const { ref, width: W } = useWidth<HTMLDivElement>();
  const shown = lines.filter((l) => !hidden.has(l.id) && l.first !== undefined);

  const H = 280;
  const L = 44;
  const R = 12;
  const T = 12;
  const B = 28;

  const geometry = useMemo(() => {
    if (days.length === 0) return null;
    const maxY = Math.max(1, ...shown.flatMap((l) => l.points.slice(l.first, l.last + 1)));
    const step = niceStep(maxY, 5);
    const top = Math.ceil(maxY / step) * step;
    const minX = days[0];
    const maxX = days[days.length - 1];
    const spanX = Math.max(1, maxX - minX);
    const x = (t: number) => L + ((t - minX) / spanX) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const ticks: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { ticks, x, y, top, minX, maxX };
  }, [shown, days, W]);

  if (!geometry || days.length < 2 || lines.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground">
        Not enough readings yet — a line needs two days.
      </div>
    );
  }
  const { ticks, x, y, top, minX, maxX } = geometry;
  const nf = new Intl.NumberFormat("de-DE");
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });

  // Each line in two parts: the screenshot months, dashed and fainter, and
  // the scrape from its first day on. The seam is a change of basis, so the
  // parts are not joined.
  const partsOf = (l: AccountLine) => {
    const idx = (from: number, to: number) => {
      const out: { x: number; y: number }[] = [];
      for (let i = Math.max(from, l.first); i <= Math.min(to, l.last); i++) {
        out.push({ x: x(days[i]), y: y(l.points[i]) });
      }
      return out;
    };
    return {
      old: l.seam >= 0 ? idx(0, l.seam) : [],
      now: idx(l.seam + 1, days.length - 1),
    };
  };
  const pathOf = (seg: { x: number; y: number }[]) =>
    seg.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const xTicks: number[] = [];
  const stepX = Math.max(1, Math.round(days.length / Math.max(2, Math.floor(W / 130))));
  for (let i = 0; i < days.length; i += stepX) xTicks.push(days[i]);

  const atHover =
    hover == null
      ? []
      : shown
          .filter((l) => hover >= l.first && hover <= l.last)
          .map((l) => ({ l, v: l.points[hover] }))
          .sort((a, b) => b.v - a.v);
  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {lines.map((l) => {
          const off = hidden.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              onMouseEnter={() => setFocus(l.id)}
              onMouseLeave={() => setFocus(null)}
              className={`flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 pr-2.5 text-[11px] transition-colors ${
                off ? "border-border/30 text-muted-foreground/50" : "border-border/60 text-foreground"
              }`}
              title={off ? "Show this line" : "Hide this line"}
            >
              <span className={off ? "opacity-40 grayscale" : ""}>
                <AccountAvatar src={l.avatar} platform={l.platform} label={l.label} size={18} color={l.color} badge={false} />
              </span>
              {l.label}
            </button>
          );
        })}
        <span className="ml-auto flex gap-1 text-[11px] text-muted-foreground">
          <button type="button" className="rounded px-1.5 hover:text-foreground" onClick={() => setHidden(new Set())}>
            all
          </button>
          <button
            type="button"
            className="rounded px-1.5 hover:text-foreground"
            onClick={() => setHidden(new Set(lines.map((l) => l.id)))}
          >
            none
          </button>
        </span>
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
            days.forEach((t, i) => {
              const d = Math.abs(x(t) - px);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            setHover(best);
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border/50" strokeWidth="1" />
              <text x={L - 8} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
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
          {shown.map((l) => {
            const { old, now } = partsOf(l);
            const dim = focus && focus !== l.id;
            return (
              <g key={l.id} opacity={dim ? 0.15 : 1}>
                {old.length > 1 && (
                  <path d={pathOf(old)} fill="none" stroke={l.color} strokeOpacity={0.5} strokeWidth="1.5" strokeDasharray="4 3" />
                )}
                {now.length > 1 && (
                  <path
                    d={pathOf(now)}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={focus === l.id ? 3 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {now.length > 0 && (
                  <circle cx={now[now.length - 1].x} cy={now[now.length - 1].y} r="3" fill={l.color} />
                )}
              </g>
            );
          })}
          {hover != null && (
            <>
              <line x1={x(days[hover])} x2={x(days[hover])} y1={T} y2={H - B} className="stroke-foreground/30" strokeWidth="1" />
              {atHover.map(({ l, v }) => (
                <circle key={l.id} cx={x(days[hover])} cy={y(v)} r="3.5" fill={l.color} />
              ))}
            </>
          )}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {fmtDate(t)}
            </text>
          ))}
        </svg>
        {hover != null && atHover.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 min-w-44 rounded-md border border-border/60 bg-card px-2.5 py-2 text-[11px] shadow"
            style={{
              left: `${Math.min(88, Math.max(0, (x(days[hover]) / W) * 100))}%`,
              transform: x(days[hover]) / W > 0.6 ? "translateX(-105%)" : "translateX(8px)",
            }}
          >
            <div className="mb-1 text-muted-foreground">{fmtDate(days[hover])}</div>
            {atHover.map(({ l, v }) => (
              <div key={l.id} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                  {l.label}
                </span>
                <span className="font-medium tabular-nums">{nf.format(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Cumulative views per account, latest reading per reel and day · axis top {compact(top)} · dashed: read off
        screenshots before the scrape · a line ends at the account&apos;s last reading
      </p>
    </div>
  );
}
