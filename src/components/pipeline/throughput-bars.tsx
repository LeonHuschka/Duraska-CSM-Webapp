"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChangeChip } from "@/components/ui/stat-tile";
import type { WeekPoint } from "@/components/pipeline/pipeline-view";

const SERIES = [
  { key: "shot", label: "Shot" },
  { key: "edited", label: "Cut" },
  { key: "posted", label: "Posted" },
] as const;
type Key = (typeof SERIES)[number]["key"];

/**
 * Reels per week as tall glass bars, the running week lit blue — one
 * measure at a time, picked in the pill on top.
 */
export function ThroughputBars({ weeks }: { weeks: WeekPoint[] }) {
  const [key, setKey] = useState<Key>("posted");
  const [hover, setHover] = useState<number | null>(null);
  const values = weeks.map((w) => w[key]);
  const max = Math.max(1, ...values);
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  // The running week is still filling, so the chip compares the last full
  // week with the one before it.
  const last = values[values.length - 2] ?? 0;
  const before = values[values.length - 3] ?? 0;
  const change = before > 0 ? (last - before) / before : null;
  const H = 230;

  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Throughput</h2>
          <p className="text-xs text-white/55">Reels per week, last 8 weeks</p>
        </div>
        <div className="flex items-center gap-2">
          {change != null && (
            <ChangeChip value={change}>
              {change > 0 ? "+" : ""}
              {Math.round(change * 100)}% vs last week
            </ChangeChip>
          )}
          <div className="glass-pill flex gap-0.5 rounded-full p-0.5">
            {SERIES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setKey(s.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium transition-all",
                  key === s.key ? "bg-white text-neutral-900" : "text-white/65 hover:text-white"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mt-5 flex gap-3">
        {/* The scale, faint */}
        <div className="flex w-6 shrink-0 flex-col justify-between pb-6 text-right text-[10px] tabular-nums text-white/35" style={{ height: H + 24 }}>
          {[top, top / 2, 0].map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="border-t border-dashed border-white/[0.07]" />
            ))}
          </div>
          <div className="relative flex items-end justify-around gap-2 sm:gap-4" style={{ height: H }}>
            {weeks.map((w, i) => {
              const v = values[i];
              const current = i === weeks.length - 1;
              const h = Math.max(12, (v / top) * H);
              return (
                <div
                  key={w.label}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {(hover === i || current) && (
                    <span
                      className="absolute z-10 -translate-y-full rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-900 shadow"
                      style={{ bottom: h + 6 }}
                    >
                      {v}
                    </span>
                  )}
                  <div
                    className={cn(
                      "w-full max-w-[52px] rounded-[16px] border transition-all duration-500",
                      current
                        ? "border-blue-300/40 bg-gradient-to-b from-blue-400 to-blue-600/50 shadow-[0_0_30px_-4px_rgba(59,130,246,0.65)]"
                        : "border-white/15 bg-gradient-to-b from-white/35 to-white/[0.06] hover:from-white/45"
                    )}
                    style={{ height: h }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-around gap-2 sm:gap-4">
            {weeks.map((w, i) => (
              <span key={w.label} className={cn("flex-1 text-center text-[10px]", i === weeks.length - 1 ? "font-semibold text-white" : "text-white/45")}>
                {i === weeks.length - 1 ? "This week" : w.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
