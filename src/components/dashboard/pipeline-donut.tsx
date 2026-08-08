/**
 * Dependency-free SVG donut for the content pipeline.
 *
 * Server-rendered — it's a static picture, so there's no reason to ship a
 * charting library to the phone for it.
 */

export interface Segment {
  label: string;
  value: number;
  /** tailwind text-* colour class, used for both arc and legend dot */
  color: string;
  hint?: string;
}

export function PipelineDonut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Segment[];
  centerLabel: string;
  centerValue: number | string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;

  // Walk the circle, giving each segment its share of the circumference.
  let offset = 0;
  const arcs = segments.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const len = frac * C;
    const arc = { ...s, len, gap: C - len, offset };
    offset += len;
    return arc;
  });

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="12"
            className="stroke-muted"
          />
          {total > 0 &&
            arcs.map((a) =>
              a.len <= 0 ? null : (
                <circle
                  key={a.label}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  strokeWidth="12"
                  strokeDasharray={`${a.len} ${a.gap}`}
                  strokeDashoffset={-a.offset}
                  className={a.color}
                />
              )
            )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{centerValue}</span>
          <span className="text-[10px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.color.replace("stroke-", "bg-")}`}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {s.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Overlapping platform badges with the live-account count hanging off the
 * edge of each — so "how many accounts am I feeding" is readable without
 * counting rows in settings.
 */
export function PlatformBadges({
  counts,
}: {
  counts: { platform: string; count: number }[];
}) {
  const shown = counts.filter((c) => c.count > 0);
  if (shown.length === 0) return null;

  return (
    <div className="flex items-center pl-1">
      {shown.map((c, i) => (
        <div
          key={c.platform}
          className={`relative ${i > 0 ? "-ml-2" : ""}`}
          style={{ zIndex: shown.length - i }}
          title={`${c.count} ${c.platform} account${c.count === 1 ? "" : "s"}`}
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-card ${
              PLATFORM_STYLE[c.platform]?.bg ?? "bg-gray-500"
            }`}
          >
            <PlatformGlyph platform={c.platform} />
          </span>
          <span className="absolute -bottom-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-background px-[3px] text-[8px] font-bold leading-none tabular-nums text-foreground ring-1 ring-border">
            {c.count}
          </span>
        </div>
      ))}
    </div>
  );
}

const PLATFORM_STYLE: Record<string, { bg: string }> = {
  instagram: { bg: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400" },
  facebook: { bg: "bg-[#1877F2]" },
  tiktok: { bg: "bg-black" },
  x: { bg: "bg-neutral-800" },
};

function PlatformGlyph({ platform }: { platform: string }) {
  const cls = "h-3.5 w-3.5 fill-white";
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-label="Instagram">
        <path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2m0 6a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6m0 6.3a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5m4-6.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8" />
      </svg>
    );
  }
  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-label="Facebook">
        <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6c-.3 0-1.28-.1-2.42-.1-2.4 0-4.05 1.47-4.05 4.16V9.9H7.5V13h2.73v8z" />
      </svg>
    );
  }
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-label="TikTok">
        <path d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3v12.1a2.4 2.4 0 1 1-1.7-2.3V9.7a5.4 5.4 0 1 0 4.7 5.4V9.4a7.2 7.2 0 0 0 4.2 1.3V7.7a4.3 4.3 0 0 1-3.2-1.9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-label="X">
      <path d="M17.5 3h3l-6.6 7.5L21.7 21h-6l-4.7-6.1L5.6 21h-3l7-8L2.6 3h6.2l4.2 5.6zm-1.1 16.2h1.7L8.1 4.7H6.3z" />
    </svg>
  );
}

/**
 * Weekly goal ring — how much of the week's minimum she has shot already.
 * The minimum is driven by how many accounts are live, since a reel can
 * only be posted once.
 */
export function WeeklyGoal({
  done,
  target,
  liveAccounts,
  manual = false,
  stockReels,
  perDay,
  stockFullDays = 10,
}: {
  done: number;
  target: number;
  liveAccounts: number;
  /** true when an owner set the target by hand rather than deriving it */
  manual?: boolean;
  /** reels she has delivered that nobody has posted yet */
  stockReels: number;
  /** reels going out per day across all live accounts */
  perDay: number;
  /** a shelf this full counts as fully stocked */
  stockFullDays?: number;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  const filled = (pct / 100) * C;

  const tone =
    pct >= 100
      ? "stroke-emerald-400"
      : pct >= 60
        ? "stroke-primary"
        : pct >= 30
          ? "stroke-amber-400"
          : "stroke-rose-400";

  const message =
    pct >= 100
      ? "Week complete — you crushed it 🎉"
      : `${Math.max(0, target - done)} more to hit this week's minimum`;

  // The ring says what she still owes this week. This says how long what she
  // has already delivered will keep the accounts fed — the shop-keeper's
  // question of when to restock, which the ring can never answer.
  const daily = Math.max(1, perDay);
  const days = stockReels / daily;
  const stockPct = Math.min(100, (days / stockFullDays) * 100);
  const stockDays =
    days > 0 && days < 1 ? days.toFixed(1) : Math.floor(days).toString();
  const stock =
    days < 3
      ? { bar: "bg-rose-400", text: "text-rose-400" }
      : days < 7
        ? { bar: "bg-amber-400", text: "text-amber-400" }
        : { bar: "bg-emerald-400", text: "text-emerald-400" };

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 110 110" className="h-28 w-28 -rotate-90">
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              strokeWidth="10"
              className="stroke-muted"
            />
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              className={`${tone} transition-all`}
              strokeDasharray={`${filled} ${C - filled}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
            <span className="text-[10px] text-muted-foreground">this week</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            <span className="text-xl font-semibold tabular-nums">{done}</span>
            <span className="text-muted-foreground"> / {target} reels</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            {manual
              ? "Weekly goal set by your manager"
              : `Based on ${liveAccounts} live account${liveAccounts === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* How long the shelf lasts, kept in the same card so the two numbers
          read as one picture rather than competing for attention. */}
      <div className="mt-4 border-t border-border/40 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">Ready to post</span>
          <span className="text-xs">
            <span className={`font-semibold tabular-nums ${stock.text}`}>
              {stockDays}
            </span>
            <span className="text-muted-foreground">
              {" "}
              {stockDays === "1" ? "day" : "days"} left
            </span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${stock.bar} transition-all`}
            style={{
              width: `${stockReels > 0 ? Math.max(stockPct, 4) : 0}%`,
            }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">
          {stockReels} reel{stockReels === 1 ? "" : "s"} waiting · {daily} go out
          a day
        </p>
      </div>
    </div>
  );
}

/** Tiny bar chart for "what did I do the last 7 days". */
export function WeekBars({
  days,
}: {
  days: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="flex items-end justify-between gap-1.5">
      {days.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[9px] tabular-nums text-muted-foreground">
            {d.value > 0 ? d.value : ""}
          </span>
          <div
            className={`w-full rounded-t ${d.value > 0 ? "bg-primary" : "bg-muted"}`}
            style={{ height: `${Math.max(3, (d.value / max) * 44)}px` }}
          />
          <span className="text-[9px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * How much shot content is left before the accounts run dry.
 *
 * This is the number she actually steers by: she supplies the raw material,
 * and the only question that matters to her is whether the shelf is still
 * stocked. Everything else on this page is history — this one says whether
 * to pick up the camera today.
 */
export function ContentStock({
  reels,
  perDay,
  targetDays = 10,
}: {
  reels: number;
  perDay: number;
  targetDays?: number;
}) {
  const daily = Math.max(1, perDay);
  const days = reels / daily;
  const pct = Math.min(1, days / targetDays);

  const tone =
    days < 3
      ? {
          text: "text-rose-400",
          bar: "bg-rose-400",
          ring: "border-rose-500/40",
          note: "Almost out — worth shooting today.",
        }
      : days < 7
        ? {
            text: "text-amber-400",
            bar: "bg-amber-400",
            ring: "border-amber-500/40",
            note: "Getting low — good time to restock.",
          }
        : {
            text: "text-emerald-400",
            bar: "bg-emerald-400",
            ring: "border-emerald-500/30",
            note: "Well stocked — you're ahead.",
          };

  // Under a day, "0 days left" reads as nothing left at all, which is a
  // different thing from "half a day".
  const shown =
    days > 0 && days < 1 ? days.toFixed(1) : Math.floor(days).toString();

  return (
    <div className={`rounded-2xl border ${tone.ring} bg-card p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-semibold tabular-nums ${tone.text}`}>
            {shown}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {shown === "1" ? "day" : "days"} of content left
          </span>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {reels} in stock
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone.bar} transition-all`}
          style={{ width: `${Math.max(pct * 100, reels > 0 ? 3 : 0)}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{tone.note}</span>
        <span className="shrink-0 tabular-nums">
          {daily}/day going out · {targetDays}d is full
        </span>
      </div>
    </div>
  );
}
