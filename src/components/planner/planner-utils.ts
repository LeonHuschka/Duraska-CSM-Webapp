import type { PlannerPost } from "@/components/planner/planner-view";

/** Local calendar day, "2026-11-03". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday, midnight. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

/** The day's posting times, spread over the day by how many it gets. */
export function postingTimes(perDay: number): string[] {
  const n = Math.min(6, Math.max(1, perDay || 2));
  const sets: Record<number, string[]> = {
    1: ["18:00"],
    2: ["12:00", "19:00"],
    3: ["09:00", "14:00", "19:00"],
    4: ["09:00", "13:00", "17:00", "21:00"],
    5: ["08:00", "11:00", "14:00", "18:00", "21:00"],
    6: ["08:00", "10:30", "13:00", "16:00", "19:00", "21:30"],
  };
  return sets[n];
}

export type PostState = "scheduled" | "overdue" | "publishing" | "posted" | "manual" | "failed";

export function stateOf(p: PlannerPost): PostState {
  if (p.status === "posted") return p.auto ? "posted" : "manual";
  if (p.publishState === "failed") return "failed";
  if (p.publishState === "uploading" || p.publishState === "publishing") return "publishing";
  if (new Date(p.at).getTime() < Date.now() - 10 * 60_000) return "overdue";
  return "scheduled";
}

export const STATE_META: Record<PostState, { label: string; chip: string; ring: string }> = {
  scheduled: { label: "Scheduled", chip: "bg-sky-500/20 text-sky-300", ring: "ring-sky-500/50" },
  overdue: { label: "Waiting", chip: "bg-orange-500/20 text-orange-300", ring: "ring-orange-500/60" },
  publishing: { label: "Posting…", chip: "bg-amber-500/20 text-amber-300", ring: "ring-amber-400/70" },
  posted: { label: "Posted", chip: "bg-emerald-500/20 text-emerald-300", ring: "ring-emerald-500/50" },
  manual: { label: "Posted by hand", chip: "bg-zinc-500/20 text-zinc-300", ring: "ring-zinc-500/40" },
  failed: { label: "Failed", chip: "bg-rose-500/20 text-rose-300", ring: "ring-rose-500/70" },
};
