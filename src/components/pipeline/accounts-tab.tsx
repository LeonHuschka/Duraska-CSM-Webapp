import { createClient } from "@/lib/supabase/server";

/**
 * The Accounts tab — one card per posting account.
 *
 * The numbers come from the screenshots the VAs post in each account's
 * Telegram topic. Right now only profile shots are being read, so follower
 * counts are all there is; the reel grid in the second screenshot is not
 * parsed yet, which is why there is no per-reel view here. Rather than
 * draw an empty pie chart, the tab says what it has and what it is missing.
 */
export async function AccountsTab({ personaId }: { personaId: string }) {
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, handle, platform, status, telegram_thread_id")
    .eq("persona_id", personaId)
    .order("platform");

  const { data: metrics } = await supabase
    .from("account_metrics")
    .select("account_id, captured_at, followers, views, metric_kind, needs_review")
    .eq("persona_id", personaId)
    .order("captured_at", { ascending: false });

  const rows = (accounts ?? []).map((a) => {
    const mine = (metrics ?? []).filter(
      (m) => m.account_id === a.id && !m.needs_review
    );
    const withFollowers = mine.filter((m) => m.followers != null);
    const latest = withFollowers[0];
    const previous = withFollowers.find(
      (m) =>
        latest &&
        new Date(m.captured_at).getTime() <
          new Date(latest.captured_at).getTime() - 12 * 60 * 60 * 1000
    );
    return {
      ...a,
      followers: latest?.followers ?? null,
      delta:
        latest?.followers != null && previous?.followers != null
          ? latest.followers - previous.followers
          : null,
      lastSeen: latest?.captured_at ?? null,
      samples: mine.length,
    };
  });

  const PLATFORM_DOT: Record<string, string> = {
    instagram: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
    facebook: "bg-[#1877F2]",
    tiktok: "bg-neutral-200",
    x: "bg-neutral-500",
  };

  const fmtAgo = (iso: string | null) => {
    if (!iso) return "no screenshots yet";
    const h = (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000);
    if (h < 1) return "just now";
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-medium">Accounts</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Read from the screenshots posted in each account&apos;s Telegram topic
        </p>

        <div className="mt-4 divide-y divide-border/40">
          {rows.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              No accounts registered yet — add them under Settings → Accounts.
            </p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  PLATFORM_DOT[r.platform] ?? "bg-muted"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">@{r.handle}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.platform}
                  {r.telegram_thread_id ? ` · topic ${r.telegram_thread_id}` : " · no topic mapped"}
                  {" · "}
                  {fmtAgo(r.lastSeen)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-semibold tabular-nums">
                  {r.followers ?? "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  followers
                  {r.delta !== null && r.delta !== 0 && (
                    <span
                      className={r.delta > 0 ? "text-emerald-400" : "text-rose-400"}
                    >
                      {" "}
                      {r.delta > 0 ? "▲" : "▼"} {Math.abs(r.delta)}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border/50 bg-card/50 p-5">
        <h2 className="text-sm font-medium">Per-reel numbers</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The VAs post two screenshots per account: the profile, and the grid
          of recent reels with a view count on each tile. Only the first is
          being read so far, which is why there is no view share, no per-reel
          list and no viral detection yet — those all need the grid.
          <br />
          <br />
          Next step is teaching the extraction to read a grid as a list of
          tiles rather than one number.
        </p>
      </div>
    </div>
  );
}
