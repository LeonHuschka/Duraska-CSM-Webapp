import { createClient } from "@/lib/supabase/server";
import { PipelineDonut } from "@/components/dashboard/pipeline-donut";

/**
 * Accounts tab: the whole operation summarised, then one card per account
 * with the reels running on it.
 *
 * Everything here is read off the screenshots the VAs post in each
 * account's Telegram topic — the profile shot gives followers, the grid
 * shot gives a view count per tile. Tiles are matched to our own reels by
 * posting order, which is the only link the screenshots offer: neither
 * carries an id.
 */

const PLATFORM_DOT: Record<string, string> = {
  instagram: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
  facebook: "bg-[#1877F2]",
  tiktok: "bg-neutral-200",
  x: "bg-neutral-500",
};
const SHARE_TONE = [
  "stroke-purple-400",
  "stroke-emerald-400",
  "stroke-amber-400",
  "stroke-blue-400",
  "stroke-rose-400",
];

const nf = new Intl.NumberFormat("de-DE");

export async function AccountsTab({ personaId }: { personaId: string }) {
  const supabase = await createClient();

  const [{ data: accounts }, { data: metrics }, { data: reels }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, handle, platform, status, telegram_thread_id")
        .eq("persona_id", personaId)
        .order("platform"),
      supabase
        .from("account_metrics")
        .select("account_id, captured_at, followers, needs_review")
        .eq("persona_id", personaId)
        .order("captured_at", { ascending: false }),
      supabase
        .from("reel_metrics")
        .select("account_id, captured_at, position, views, likes, caption, needs_review")
        .eq("persona_id", personaId)
        .order("captured_at", { ascending: false }),
    ]);

  // Which of our reels went out on which account, newest first — this is
  // what turns "tile 3" into a reel with a name.
  const { data: slots } = await supabase
    .from("schedule_slots")
    .select("account_id, request_id, posted_at, scheduled_for")
    .eq("persona_id", personaId)
    .eq("status", "posted");

  const postedByAccount = new Map<string, { requestId: string; at: number }[]>();
  for (const s of slots ?? []) {
    if (!s.account_id || !s.request_id) continue;
    const when = s.posted_at ?? s.scheduled_for;
    if (!when) continue;
    const list = postedByAccount.get(s.account_id) ?? [];
    list.push({ requestId: s.request_id, at: new Date(when).getTime() });
    postedByAccount.set(s.account_id, list);
  }
  postedByAccount.forEach((list) => list.sort((a, b) => b.at - a.at));

  const titles = new Map<string, string>();
  const allPosted: { requestId: string; at: number }[] = [];
  postedByAccount.forEach((list) => allPosted.push(...list));
  const requestIds = Array.from(new Set(allPosted.map((p) => p.requestId)));
  if (requestIds.length) {
    const { data: reqs } = await supabase
      .from("content_requests")
      .select("id, title")
      .in("id", requestIds);
    for (const r of reqs ?? []) titles.set(r.id, r.title);
  }

  const rows = (accounts ?? []).map((a, i) => {
    const followerRows = (metrics ?? []).filter(
      (m) => m.account_id === a.id && !m.needs_review && m.followers != null
    );
    const latest = followerRows[0];
    const previous = followerRows.find(
      (m) =>
        latest &&
        new Date(m.captured_at).getTime() <
          new Date(latest.captured_at).getTime() - 12 * 60 * 60 * 1000
    );

    // Only the newest grid — an older one describes the same reels with
    // smaller numbers and would double-count every view.
    const mine = (reels ?? []).filter((r) => r.account_id === a.id);
    const newestCapture = mine[0]?.captured_at ?? null;
    const tiles = mine
      .filter((r) => r.captured_at === newestCapture)
      .sort((x, y) => x.position - y.position)
      .map((r) => ({
        position: r.position,
        views: r.views,
        likes: r.likes,
        caption: r.caption,
        title:
          titles.get(
            postedByAccount.get(a.id)?.[r.position - 1]?.requestId ?? ""
          ) ?? null,
      }));

    return {
      ...a,
      tone: SHARE_TONE[i % SHARE_TONE.length],
      followers: latest?.followers ?? null,
      followerDelta:
        latest?.followers != null && previous?.followers != null
          ? latest.followers - previous.followers
          : null,
      lastSeen: latest?.captured_at ?? newestCapture ?? null,
      tiles,
      views: tiles.reduce((sum, t) => sum + (t.views ?? 0), 0),
      uploads: tiles.length,
    };
  });

  const totalViews = rows.reduce((a, r) => a + r.views, 0);
  const totalFollowers = rows.reduce((a, r) => a + (r.followers ?? 0), 0);
  const share = rows
    .filter((r) => r.views > 0)
    .map((r) => ({ label: `@${r.handle}`, value: r.views, color: r.tone }));

  const fmtAgo = (iso: string | null) => {
    if (!iso) return "no screenshots yet";
    const h = (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000);
    if (h < 1) return "just now";
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-medium">Accounts summarized</h2>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {nf.format(totalViews)}
            </p>
            <p className="text-xs text-muted-foreground">All views</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {nf.format(totalFollowers)}
            </p>
            <p className="text-xs text-muted-foreground">All followers</p>
          </div>
        </div>

        {share.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              Views by account
            </h3>
            <PipelineDonut
              segments={share}
              centerLabel="views"
              centerValue={nf.format(totalViews)}
            />
          </div>
        )}
      </div>

      {/* One card per account */}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  PLATFORM_DOT[r.platform] ?? "bg-muted"
                }`}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">@{r.handle}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.platform}
                  {r.telegram_thread_id
                    ? ` · topic ${r.telegram_thread_id}`
                    : " · no topic mapped"}
                  {" · "}
                  {fmtAgo(r.lastSeen)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-6 text-right">
              <div>
                <p className="text-base font-semibold tabular-nums">
                  {r.uploads}
                </p>
                <p className="text-[11px] text-muted-foreground">reels</p>
              </div>
              <div>
                <p className="text-base font-semibold tabular-nums">
                  {nf.format(r.views)}
                </p>
                <p className="text-[11px] text-muted-foreground">views</p>
              </div>
              <div>
                <p className="text-base font-semibold tabular-nums">
                  {r.followers ?? "—"}
                  {r.followerDelta !== null && r.followerDelta !== 0 && (
                    <span
                      className={`ml-1 text-xs ${
                        r.followerDelta > 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {r.followerDelta > 0 ? "▲" : "▼"}
                      {Math.abs(r.followerDelta)}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">followers</p>
              </div>
            </div>
          </div>

          {r.tiles.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              No reel grid read yet — the second screenshot from this topic is
              what fills this row.
            </p>
          ) : (
            <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {r.tiles.map((t) => (
                <div
                  key={t.position}
                  className="flex w-28 shrink-0 flex-col justify-between rounded-xl border border-border/40 bg-muted/30 p-2"
                >
                  <p className="text-[10px] text-muted-foreground">
                    #{t.position}
                  </p>
                  <p className="mt-3 truncate text-xs font-medium">
                    {t.title ?? t.caption ?? "unmatched"}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="tabular-nums">
                      ▶ {t.views != null ? nf.format(t.views) : "—"}
                    </span>
                    {t.likes != null && (
                      <span className="tabular-nums text-muted-foreground">
                        ♥ {nf.format(t.likes)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
