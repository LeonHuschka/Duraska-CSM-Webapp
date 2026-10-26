"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { berlinDay } from "@/lib/berlin-day";

/**
 * What an account posted, day by day, against what it should: regular
 * reels and trial reels, each with its own number a day. A day is green
 * once both are met, red when nothing went up at all, yellow for anything
 * in between. Days are Berlin days; the scrape reads every morning, so
 * today only fills in tomorrow and is not held against anyone yet.
 */

export type DayCount = { r: number; t: number };
export type Posting = {
  /** The first day we can speak for — the oldest reel the scrape has seen. */
  since: string | null;
  /** "YYYY-MM-DD" → regular and trial reels posted that day. */
  days: Record<string, DayCount>;
};
export type Need = { r: number; t: number };
type Tone = "green" | "yellow" | "red" | "plain" | "pending" | "none";

const DAY = 86_400_000;

// Plain calendar arithmetic on "YYYY-MM-DD", in UTC so no hour ever shifts a day.
const toTime = (k: string) => Date.parse(`${k}T00:00:00Z`);
const toKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (k: string, n: number) => toKey(toTime(k) + n * DAY);
const mondayOf = (k: string) => addDays(k, -((new Date(toTime(k)).getUTCDay() + 6) % 7));

function toneOf(key: string, today: string, since: string | null, d: DayCount, need: Need): Tone {
  if (key > today || !since || key < since) return "none";
  if (need.r + need.t === 0) return d.r + d.t > 0 ? "plain" : "none";
  if (d.r >= need.r && d.t >= need.t) return "green";
  if (key === today) return "pending";
  return d.r + d.t === 0 ? "red" : "yellow";
}

const TONE: Record<Tone, string> = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  yellow: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  red: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  plain: "border-border/40 bg-muted/30 text-foreground",
  pending: "border-dashed border-foreground/30 bg-transparent text-foreground",
  none: "border-border/20 bg-muted/10 text-muted-foreground/50",
};
const DOT: Record<Tone, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-rose-500",
  plain: "bg-foreground/40",
  pending: "bg-foreground/20",
  none: "bg-muted/60",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The last seven days as seven small bars, for the tile. */
export function PostingStrip({ posting, need }: { posting: Posting; need: Need }) {
  const today = berlinDay(new Date());
  const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="mt-3 flex gap-1" title="The last 7 days: green all posted, yellow some, red none">
      {keys.map((k) => {
        const d = posting.days[k] ?? { r: 0, t: 0 };
        return <span key={k} className={`h-1.5 flex-1 rounded-full ${DOT[toneOf(k, today, posting.since, d, need)]}`} />;
      })}
    </div>
  );
}

export function PostingCalendar({ posting, need }: { posting: Posting; need: Need }) {
  const today = berlinDay(new Date());
  const [mode, setMode] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);
  const trials = need.t > 0 || Object.values(posting.days).some((d) => d.t > 0);

  const view = useMemo(() => {
    if (mode === "week") {
      // The seven days up to today, so a Monday does not open on an empty week.
      const start = addDays(today, offset * 7 - 6);
      const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const end = keys[6];
      const label =
        offset === 0
          ? "Last 7 days"
          : `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short" })}`;
      return { cells: keys.map((k) => ({ key: k, inMonth: true })), label };
    }
    const [y, m] = today.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const firstKey = toKey(first.getTime());
    const lastKey = toKey(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const start = mondayOf(firstKey);
    const end = addDays(mondayOf(lastKey), 6);
    const cells: { key: string; inMonth: boolean }[] = [];
    for (let k = start; k <= end; k = addDays(k, 1)) cells.push({ key: k, inMonth: k >= firstKey && k <= lastKey });
    return { cells, label: fmt(firstKey, { month: "long", year: "numeric" }) };
  }, [mode, offset, today]);

  // What the shown days add up to — only the days that are over and that
  // we can speak for.
  const counted = view.cells.filter((c) => c.inMonth && c.key < today && posting.since && c.key >= posting.since);
  const sum = counted.reduce(
    (a, c) => {
      const d = posting.days[c.key] ?? { r: 0, t: 0 };
      return { r: a.r + d.r, t: a.t + d.t, full: a.full + (d.r >= need.r && d.t >= need.t ? 1 : 0) };
    },
    { r: 0, t: 0, full: 0 },
  );

  return (
    <div className="mt-4 rounded-xl border border-border/40 bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Posting</p>
        <div className="ml-2 inline-flex rounded-md border border-border/50 p-0.5 text-[11px]">
          {(["week", "month"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setOffset(0);
              }}
              className={`rounded px-2 py-0.5 capitalize transition-colors ${
                mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Earlier"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOffset(0)}
            className="min-w-[7.5rem] text-center text-xs font-medium tabular-nums"
            title="Back to now"
          >
            {view.label}
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset >= 0}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            aria-label="Later"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {(mode === "week" ? view.cells.map((c) => fmt(c.key, { weekday: "short" })) : WEEKDAYS).map((w) => (
          <span key={w} className="text-center text-[10px] text-muted-foreground">
            {w}
          </span>
        ))}
        {view.cells.map(({ key, inMonth }) => {
          if (!inMonth) return <span key={key} />;
          const d = posting.days[key] ?? { r: 0, t: 0 };
          const tone = toneOf(key, today, posting.since, d, need);
          const known = tone !== "none" || (key <= today && posting.since != null && key >= posting.since);
          const isToday = key === today;
          return (
            <div
              key={key}
              title={
                tone === "none" && key > today
                  ? undefined
                  : `${fmt(key, { weekday: "long", day: "numeric", month: "long" })}: ${d.r} reel${d.r === 1 ? "" : "s"}${
                      trials ? ` · ${d.t} trial` : ""
                    }${need.r + need.t > 0 ? ` (needs ${need.r}${trials ? ` + ${need.t} trial` : ""})` : ""}${
                      isToday ? " — today is read tomorrow morning" : ""
                    }`
              }
              className={`relative flex flex-col items-center justify-center rounded-lg border ${TONE[tone]} ${
                mode === "week" ? "h-20" : "h-14"
              } ${isToday ? "ring-1 ring-foreground/50" : ""}`}
            >
              <span className="absolute left-1.5 top-1 text-[9px] tabular-nums opacity-70">{Number(key.slice(8))}</span>
              {known ? (
                <>
                  <span className={`font-bold tabular-nums leading-none ${mode === "week" ? "text-2xl" : "text-lg"}`}>
                    {tone === "pending" && d.r + d.t === 0 ? "–" : d.r}
                  </span>
                  {trials && (
                    <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums opacity-90">
                      <FlaskConical className="h-2.5 w-2.5" />
                      {d.t}
                    </span>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {need.r + need.t > 0 && counted.length > 0 && (
          <span className="text-foreground">
            <b className="tabular-nums">{sum.full}</b> of {counted.length} days complete ·{" "}
            <span className="tabular-nums">
              {sum.r}/{need.r * counted.length}
            </span>{" "}
            reels
            {trials && (
              <>
                {" "}
                ·{" "}
                <span className="tabular-nums">
                  {sum.t}/{need.t * counted.length}
                </span>{" "}
                trial
              </>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <Legend tone="green" label="all posted" />
          <Legend tone="yellow" label="some" />
          <Legend tone="red" label="none" />
          {trials && (
            <span className="inline-flex items-center gap-1">
              <FlaskConical className="h-3 w-3" /> trial reels
            </span>
          )}
        </span>
      </div>
      {need.r + need.t === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">Set reels a day above to colour the days.</p>
      )}
    </div>
  );
}

function Legend({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${DOT[tone]}`} />
      {label}
    </span>
  );
}

function fmt(key: string, o: Intl.DateTimeFormatOptions) {
  return new Date(toTime(key)).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
}
