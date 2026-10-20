"use client";

import { useState } from "react";
import { compact } from "@/lib/account-analytics";
import { AccountAvatar } from "@/components/pipeline/account-avatar";

type Slice = { id: string; label: string; value: number; color: string; platform: string; avatar: string | null };

/** Who the reach belongs to. Size, not momentum — that is the other chart. */
export function ViewDistribution({ slices }: { slices: Slice[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((a, s) => a + s.value, 0);
  const nf = new Intl.NumberFormat("de-DE");
  const R = 42;
  const C = 2 * Math.PI * R;

  let offset = 0;
  const arcs = sorted.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const len = frac * C;
    const arc = { ...s, frac, len, gap: C - len, offset };
    offset += len;
    return arc;
  });
  const active = arcs.find((a) => a.id === hover) ?? null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-36 w-36 -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="12" className="stroke-muted" />
          {arcs.map((a) => (
            <circle
              key={a.id}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              strokeWidth={hover === a.id ? 14 : 12}
              stroke={a.color}
              strokeOpacity={hover && hover !== a.id ? 0.35 : 1}
              strokeDasharray={`${a.len} ${a.gap}`}
              strokeDashoffset={-a.offset}
              onMouseEnter={() => setHover(a.id)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default transition-all"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {active ? (
            <>
              <span className="text-lg font-semibold tabular-nums">{compact(active.value)}</span>
              <span className="max-w-[5.5rem] truncate text-[10px] text-muted-foreground">
                {active.label}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {(active.frac * 100).toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-semibold tabular-nums">{compact(total)}</span>
              <span className="text-[10px] text-muted-foreground">views</span>
            </>
          )}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {arcs.map((a) => (
          <li
            key={a.id}
            className={`flex items-center gap-2 text-xs transition-opacity ${
              hover && hover !== a.id ? "opacity-50" : ""
            }`}
            onMouseEnter={() => setHover(a.id)}
            onMouseLeave={() => setHover(null)}
            title={`${a.label}: ${nf.format(a.value)} views · ${(a.frac * 100).toFixed(1)}%`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <AccountAvatar src={a.avatar} platform={a.platform} label={a.label} size={20} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{compact(a.value)}</span>
            <span className="w-12 shrink-0 text-right font-medium tabular-nums">
              {(a.frac * 100).toFixed(1)}%
            </span>
          </li>
        ))}
        {arcs.length === 0 && (
          <li className="text-xs text-muted-foreground">No views in this period yet.</li>
        )}
      </ul>
    </div>
  );
}
