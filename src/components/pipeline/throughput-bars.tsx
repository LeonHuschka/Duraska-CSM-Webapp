"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChangeChip } from "@/components/ui/stat-tile";
import type { WeekPoint } from "@/components/pipeline/pipeline-view";

/**
 * The three measures nest from the outside in, widest first: shot is the
 * outer glass, cut sits inside it, posted is the bright core. Each keeps
 * its own colour, so one bar per week tells whether the machine keeps up.
 */
const SERIES = [
  {
    key: "shot",
    label: "Shot",
    dot: "bg-violet-400",
    width: "100%",
    bar: "border-violet-300/35 bg-gradient-to-b from-violet-400/45 to-violet-500/[0.08]",
  },
  {
    key: "edited",
    label: "Cut",
    dot: "bg-emerald-400",
    width: "64%",
    bar: "border-emerald-300/40 bg-gradient-to-b from-emerald-400/75 to-emerald-500/20",
  },
  {
    key: "posted",
    label: "Posted",
    dot: "bg-blue-400",
    width: "32%",
    bar: "border-blue-200/50 bg-gradient-to-b from-blue-300 to-blue-500/60 shadow-[0_0_18px_-2px_rgba(59,130,246,0.7)]",
  },
] as const;

export function ThroughputBars({ weeks }: { weeks: WeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.flatMap((w) => [w.shot, w.edited, w.posted]));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  // The running week is still filling, so the chip compares the last full
  // week's posts with the week before it.
  const last = weeks[weeks.length - 2]?.posted ?? 0;
  const before = weeks[weeks.length - 3]?.posted ?? 0;
  const change = before > 0 ? (last - before) / before : null;
  const H = 230;
  const h = (v: number) => (v > 0 ? Math.max(10, (v / top) * H) : 0);

  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Throughput</h2>
          <p className="text-xs text-white/55">Reels per week, last 8 weeks</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-white/70">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                {s.label}
              </span>
            ))}
          </div>
          {change != null && (
            <ChangeChip value={change}>
              Posted {change > 0 ? "+" : ""}
              {Math.round(change * 100)}% vs week before
            </ChangeChip>
          )}
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
              const current = i === weeks.length - 1;
              const tallest = Math.max(h(w.shot), h(w.edited), h(w.posted));
              return (
                <div
                  key={w.label}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {hover === i && (
                    <div
                      className="absolute z-10 -translate-y-full whitespace-nowrap rounded-xl border border-white/15 bg-popover px-2.5 py-1.5 text-[11px] tabular-nums shadow-xl"
                      style={{ bottom: tallest + 8 }}
                    >
                      {SERIES.map((s) => (
                        <div key={s.key} className="flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                          <span className="text-white/60">{s.label}</span>
                          <span className="ml-auto pl-3 font-semibold">{w[s.key]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={cn("relative h-full w-full max-w-[56px]", current && "drop-shadow-[0_0_14px_rgba(255,255,255,0.18)]")}>
                    {SERIES.map((s) => {
                      const v = w[s.key];
                      if (v <= 0) return null;
                      return (
                        <div
                          key={s.key}
                          className={cn(
                            "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[16px] border transition-all duration-500",
                            s.bar
                          )}
                          style={{ width: s.width, height: h(v) }}
                        />
                      );
                    })}
                    {w.shot + w.edited + w.posted === 0 && (
                      <div className="absolute bottom-0 left-1/2 h-1.5 w-full -translate-x-1/2 rounded-full bg-white/10" />
                    )}
                  </div>
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
