"use client";

import { useState } from "react";
import world from "@/lib/world-map.json";
import { countryName } from "@/lib/country-name";

type Countries = Record<string, { views: number; clicks: number }>;

/**
 * Where the people came from, as a map: every country with visits is
 * tinted, the busiest brightest. Hover a country for its numbers.
 */
export function WorldMap({ countries }: { countries: Countries }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...Object.values(countries).map((c) => c.views));
  const shade = (code: string) => {
    const c = countries[code];
    if (!c || c.views === 0) return "#2a2a30";
    const t = Math.sqrt(c.views / max);
    // from a dim violet to a bright one
    const l = 30 + t * 40;
    return `hsl(262 70% ${l}%)`;
  };
  const data = world as { w: number; h: number; c: Record<string, { n: string; d: string }> };
  const active = hover ? countries[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${data.w} ${data.h}`} className="w-full" onMouseLeave={() => setHover(null)}>
        {Object.entries(data.c).map(([code, { d }]) => (
          <path
            key={code}
            d={d}
            fill={shade(code)}
            stroke="#0f0f12"
            strokeWidth="0.6"
            opacity={hover && hover !== code && countries[code] ? 0.7 : 1}
            onMouseEnter={() => setHover(code)}
            className="transition-opacity"
          />
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs shadow">
          <div className="font-medium">{countryName(hover)}</div>
          <div className="text-muted-foreground">
            {active ? `${active.views} views · ${active.clicks} clicks` : "no visits"}
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
        <span>fewer</span>
        <span className="flex h-2 w-24 overflow-hidden rounded-full">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((t) => (
            <span key={t} className="flex-1" style={{ background: `hsl(262 70% ${30 + t * 40}%)` }} />
          ))}
        </span>
        <span>more</span>
      </div>
    </div>
  );
}
