import type { PlannerPost } from "@/components/planner/planner-view";

/**
 * The planner runs on the account's own clock — a US account plans in
 * New York time, whatever the viewer's computer says. Days are keys
 * ("2026-11-03") in that zone; a key and a time make an instant.
 */
export const DEFAULT_TZ = "Europe/Berlin";

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "America/New_York", label: "New York (ET)" },
  { id: "America/Chicago", label: "Chicago (CT)" },
  { id: "America/Denver", label: "Denver (MT)" },
  { id: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Berlin" },
];

export function tzLabel(tz: string): string {
  return TIMEZONES.find((t) => t.id === tz)?.label ?? tz;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(d: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** The calendar day in the zone, "2026-11-03". */
export function dayKey(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function hhmm(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.hour}:${p.minute}`;
}

/** The hour of the day in the zone, 0–23. */
export function hourIn(d: Date, tz: string): number {
  return Number(parts(d, tz).hour);
}

/** How far the zone is ahead of UTC at that instant, in ms. */
function offset(d: Date, tz: string): number {
  const p = parts(d, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 60_000) * 60_000;
}

/** "19:00" on that day in the zone, as an instant. */
export function atTime(day: string, time: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  // Twice: the first guess may sit across a clock change.
  let t = wall - offset(new Date(wall), tz);
  t = wall - offset(new Date(t), tz);
  return new Date(t);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: string): string {
  return addDays(day, -weekday(day));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** "Tue 03.11., 19:00" in the zone. */
export function whenLabel(d: Date, tz: string, withTime = true): string {
  return d.toLocaleString("de-DE", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/**
 * The day's posting times when the account's own reels do not say better:
 * lunch and evening for one audience, spread wider the more posts a day.
 * Studies disagree past that — the account's own numbers decide once there
 * are enough (see bestTimes).
 */
export function postingTimes(perDay: number): string[] {
  const n = Math.min(6, Math.max(1, perDay || 2));
  const sets: Record<number, string[]> = {
    1: ["19:00"],
    2: ["12:00", "19:00"],
    3: ["09:00", "13:00", "19:00"],
    4: ["09:00", "12:00", "17:00", "20:00"],
    5: ["08:00", "11:00", "14:00", "17:00", "20:00"],
    6: ["08:00", "10:30", "13:00", "16:00", "19:00", "21:30"],
  };
  return sets[n];
}

/** Two-hour windows of the day, with how reels posted in them did. */
export type HourWindow = { from: number; reels: number; lift: number | null };

/**
 * The posting times from the account's own reels: the best windows, at
 * least three hours apart, as many as it posts a day. Null while too few
 * windows have enough reels to say anything.
 */
export function bestTimes(windows: HourWindow[], perDay: number): string[] | null {
  const n = Math.min(6, Math.max(1, perDay || 2));
  const rated = windows.filter((w) => w.lift != null).sort((a, b) => b.lift! - a.lift!);
  if (rated.length < Math.max(3, n)) return null;
  const picked: number[] = [];
  for (const w of rated) {
    const mid = w.from + 1;
    if (picked.every((p) => Math.abs(p - mid) >= 3 && 24 - Math.abs(p - mid) >= 3)) picked.push(mid);
    if (picked.length === n) break;
  }
  if (picked.length < n) return null;
  return picked.sort((a, b) => a - b).map((h) => `${String(h).padStart(2, "0")}:00`);
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

/** Takes of one reel on one account at least this far apart. */
export const SAME_REEL_GAP_MS = 48 * 3600_000;
