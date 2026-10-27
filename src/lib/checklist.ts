import { berlinDay } from "@/lib/berlin-day";

/**
 * How long a tick on a checklist entry holds before the box is open again:
 * for good, or for 1, 7 or 30 Berlin days counted from the day it was ticked.
 */
export const REPEATS = [
  { key: "all", label: "All time", days: null },
  { key: "1d", label: "1d", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
] as const;
export type RepeatKey = (typeof REPEATS)[number]["key"];

export const isRepeat = (v: unknown): v is RepeatKey => REPEATS.some((r) => r.key === v);

const dayNumber = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000;

/** Whether a ticked entry still counts as done today. */
export function stillDone(done: boolean, doneAt: string | null, repeat: string, now = new Date()) {
  if (!done) return false;
  const days = REPEATS.find((r) => r.key === repeat)?.days ?? null;
  if (days === null) return true;
  if (!doneAt) return false;
  return dayNumber(berlinDay(now)) - dayNumber(berlinDay(doneAt)) < days;
}
