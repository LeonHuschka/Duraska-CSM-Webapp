import { berlinDay } from "@/lib/berlin-day";

/**
 * "Visitors today" on the gate: a figure in the thousands that grows
 * through the day and starts over at midnight (Berlin). Seeded by the date,
 * so everyone sees the same number at the same moment and a reload does
 * not jump backwards.
 */
export function visitorsToday(now = new Date()): number {
  const day = berlinDay(now);
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const base = 3800 + (h % 2600); // where the day ends: 3,800–6,400
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "numeric", minute: "numeric", hour12: false })
    .formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const f = (hour * 60 + minute) / 1440;
  return Math.round(base * (0.22 + 0.78 * f));
}
