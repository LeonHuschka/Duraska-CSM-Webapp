"use client";

import { useState } from "react";
import { compact, niceStep, type AccountStats } from "@/lib/account-analytics";
import { useWidth } from "./use-width";

/**
 * Size against momentum, one bubble per account.
 *
 *   x  followers — how big the account is
 *   y  momentum — views gained in the period per follower
 *   ●  area — views gained in the period
 *
 * The quadrant lines sit at the medians of what is on screen, so "high"
 * always means "higher than the others here", not a number somebody typed.
 * An account at the top left is doing far more than its size explains —
 * the one to look at today.
 */
export function MomentumChart({ accounts }: { accounts: AccountStats[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = accounts.filter(
    (a) => a.followers != null && a.followers > 0 && a.momentum != null
  );

  const { ref, width: W } = useWidth<HTMLDivElement>();
  const H = 300;
  const L = 52;
  const R = 20;
  const T = 24;
  const B = 36;
  const nf = new Intl.NumberFormat("de-DE");

  if (shown.length === 0) {
    return (
      <div ref={ref} className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground">
        Needs a follower reading and views in the period for at least one account.
      </div>
    );
  }

  // Followers span orders of magnitude between a fresh page and an old
  // account, so x is logarithmic; momentum is compared linearly.
  const fx = shown.map((a) => Math.log10(Math.max(1, a.followers!)));
  const fy = shown.map((a) => a.momentum!);
  const minX = Math.floor(Math.min(...fx) * 2) / 2 - 0.25;
  const maxX = Math.ceil(Math.max(...fx) * 2) / 2 + 0.25;
  const stepY = niceStep(Math.max(...fy) * 1.15 || 1, 4);
  const maxY = Math.ceil((Math.max(...fy) * 1.15 || 1) / stepY) * stepY;
  const x = (f: number) => L + ((Math.log10(Math.max(1, f)) - minX) / (maxX - minX)) * (W - L - R);
  const y = (m: number) => T + (1 - m / maxY) * (H - T - B);
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const medX = Math.pow(10, median(fx));
  const medY = median(fy);
  const maxViews = Math.max(1, ...shown.map((a) => a.views));
  // Faces need room to be recognised: never smaller than 12px across.
  const radius = (v: number) => 12 + Math.sqrt(Math.max(0, v) / maxViews) * Math.min(22, W / 26);

  const xTicks: number[] = [];
  for (let e = Math.ceil(minX); e <= Math.floor(maxX); e++) xTicks.push(Math.pow(10, e));
  const yTicks: number[] = [];
  for (let v = 0; v <= maxY + 1e-9; v += stepY) yTicks.push(Math.round(v * 100) / 100);

  const active = shown.find((a) => a.id === hover) ?? null;
  const quadrant = (a: AccountStats) => {
    const big = a.followers! >= medX;
    const hot = a.momentum! >= medY;
    return hot ? (big ? "Strong performer" : "Breakout") : big ? "Established, slowing" : "Low traction";
  };

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="glass-glow block max-w-full"
        onMouseLeave={() => setHover(null)}
      >
        {/* quadrant labels, set into the background; they collide on a phone */}
        {W >= 520 &&
          (
            [
              { text: "Breakout / viral", x: L + 8, y: T + 12, anchor: "start" },
              { text: "Strong performers", x: W - R - 8, y: T + 12, anchor: "end" },
              { text: "Low traction", x: L + 8, y: H - B - 6, anchor: "start" },
              { text: "Established / slowing", x: W - R - 8, y: H - B - 6, anchor: "end" },
            ] as const
          ).map((q) => (
            <text
              key={q.text}
              x={q.x}
              y={q.y}
              textAnchor={q.anchor}
              className="fill-muted-foreground/40"
              fontSize="10"
              letterSpacing="0.04em"
            >
              {q.text.toUpperCase()}
            </text>
          ))}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border/40" strokeWidth="1" />
            <text x={L - 8} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
              {v}×
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="stroke-border/40" strokeWidth="1" />
            <text x={x(v)} y={H - B + 14} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {compact(v)}
            </text>
          </g>
        ))}
        {/* medians */}
        <line x1={x(medX)} x2={x(medX)} y1={T} y2={H - B} className="stroke-foreground/25" strokeWidth="1" strokeDasharray="4 4" />
        <line x1={L} x2={W - R} y1={y(medY)} y2={y(medY)} className="stroke-foreground/25" strokeWidth="1" strokeDasharray="4 4" />
        <text x={L} y={H - 4} className="fill-muted-foreground" fontSize="10">
          followers →
        </text>
        <text x={14} y={T + 4} className="fill-muted-foreground" fontSize="10" transform={`rotate(-90 14 ${T + 4})`} textAnchor="end">
          momentum (views ÷ followers) →
        </text>

        {[...shown]
          .sort((a, b) => b.views - a.views)
          .map((a) => {
            const cx = x(a.followers!);
            const cy = y(a.momentum!);
            const r = radius(a.views);
            const dim = hover && hover !== a.id;
            return (
              <g
                key={a.id}
                className="cursor-pointer"
                onMouseEnter={() => setHover(a.id)}
                onClick={() => {
                  location.hash = `account-${a.id}`;
                }}
              >
                <defs>
                  <clipPath id={`mom-${a.id}`}>
                    <circle cx={cx} cy={cy} r={r} />
                  </clipPath>
                </defs>
                <g opacity={dim ? 0.3 : 1}>
                  {a.avatar ? (
                    <image
                      href={a.avatar}
                      x={cx - r}
                      y={cy - r}
                      width={r * 2}
                      height={r * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#mom-${a.id})`}
                    />
                  ) : (
                    <>
                      <circle cx={cx} cy={cy} r={r} fill={a.color} />
                      <text x={cx} y={cy + r * 0.35} textAnchor="middle" fontSize={r} fontWeight="600" fill="#fff">
                        {a.label.replace(/^@/, "").slice(0, 1).toUpperCase()}
                      </text>
                    </>
                  )}
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth="2.5" />
                  <image
                    href={`/brand/${a.platform === "facebook" ? "facebook" : "instagram"}.svg`}
                    x={cx + r * 0.7 - 7}
                    y={cy + r * 0.7 - 7}
                    width="14"
                    height="14"
                  />
                </g>
                <text
                  x={cx}
                  y={cy - r - 5}
                  textAnchor="middle"
                  fontSize="10"
                  className={dim ? "fill-muted-foreground/40" : "fill-foreground"}
                >
                  {a.label}
                </text>
              </g>
            );
          })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute rounded-md border border-border/60 bg-card px-2.5 py-2 text-[11px] shadow"
          style={{
            left: `${Math.min(70, (x(active.followers!) / W) * 100 + 2)}%`,
            top: `${Math.max(0, (y(active.momentum!) / H) * 100 - 30)}%`,
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ background: active.color }} />
            {active.label}
            <span className="font-normal text-muted-foreground">· {quadrant(active)}</span>
          </div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
            <span className="text-muted-foreground">Followers</span>
            <span className="text-right">{nf.format(active.followers!)}</span>
            <span className="text-muted-foreground">Views</span>
            <span className="text-right">{nf.format(Math.round(active.views))}</span>
            <span className="text-muted-foreground">Momentum</span>
            <span className="text-right">{active.momentum!.toFixed(1)}×</span>
            {active.avgPerReel != null && (
              <>
                <span className="text-muted-foreground">Views / reel</span>
                <span className="text-right">{nf.format(Math.round(active.avgPerReel))}</span>
              </>
            )}
            {active.engagementRate != null && (
              <>
                <span className="text-muted-foreground">Engagement</span>
                <span className="text-right">{(active.engagementRate * 100).toFixed(1)}%</span>
              </>
            )}
          </div>
        </div>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Size = views gained in the period · lines at the medians of the accounts shown · click a face to open its tile
      </p>
    </div>
  );
}
