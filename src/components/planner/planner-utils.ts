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
 * The day's posting times, on the account's clock — for a US account in
 * New York time. From the posting-time research of 07.11.2026 (Buffer,
 * Sprout, Hootsuite, Metricool, Later, agency practice): the main reel in
 * the evening, 19:30–20:30 ET, when the East Coast is off work and the
 * West Coast at dinner; a second at lunch, 12:30–13:00; a third in the
 * morning, 08:30; past that, 23:30 (midnight reels get the most views)
 * and late morning. Never 02:00–05:00, the dead hours of every study.
 * Friday and Saturday evenings peak later, 21–22; Saturday mornings are
 * slow, so its first post waits until 11:00.
 */
export const DEFAULT_PER_DAY = 3;

const SLOT_SETS: Record<number, string[]> = {
  1: ["20:30"],
  2: ["12:30", "20:30"],
  3: ["08:30", "13:00", "20:30"],
  4: ["08:30", "13:00", "19:30", "23:30"],
  5: ["08:30", "11:00", "13:30", "19:30", "23:30"],
  6: ["08:30", "10:30", "13:00", "15:00", "19:30", "23:30"],
};

/** The posting times of a day — of `day` ("2026-11-03") when given, with Friday's and Saturday's shifts. */
export function postingTimes(perDay: number, day?: string): string[] {
  const n = Math.min(6, Math.max(1, perDay || DEFAULT_PER_DAY));
  let times = SLOT_SETS[n];
  const wd = day ? weekday(day) : -1;
  if (wd === 4 || wd === 5) times = times.map((t) => (t === "19:30" || t === "20:30" ? "21:30" : t));
  if (wd === 5) times = times.map((t) => (t === "08:30" ? (times.includes("11:00") ? "09:30" : "11:00") : t));
  return [...times].sort();
}

/** Two-hour windows of the day, with how reels posted in them did. */
export type HourWindow = { from: number; reels: number; lift: number | null };

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
