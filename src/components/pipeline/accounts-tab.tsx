import { createClient } from "@/lib/supabase/server";
import {
  PipelineDonut,
  TrendChart,
  PlatformGlyph,
  PLATFORM_STYLE,
} from "@/components/dashboard/pipeline-donut";
import { AccountControls } from "@/components/pipeline/account-controls";
import { AccountsActionsBar } from "@/components/pipeline/accounts-actions-bar";
import { ReelCover } from "@/components/pipeline/reel-cover";

/**
 * Accounts tab: the whole operation summarised, then one card per account
 * with the reels running on it.
 *
 * The numbers come from a daily scrape of each account on its platform
 * (account-scrape.ts): followers, and the latest posts with views, likes,
 * comments and — on Facebook — shares. Every post is keyed on the
 * platform's own id, so a reel is one row however many days it is seen,
 * and a day-over-day change is the same post read twice.
 *
 * Rows from the older screenshot pipeline are still in the tables and are
 * used only for an account the scrape has never reached.
 */

const SHARE_TONE = [
  "stroke-purple-400",
  "stroke-emerald-400",
  "stroke-amber-400",
  "stroke-blue-400",
  "stroke-rose-400",
];
/** The same palette for lines, which take a text colour. */
const LINE_TONE = [
  "text-purple-400",
  "text-emerald-400",
  "text-amber-400",
  "text-blue-400",
  "text-rose-400",
];

const nf = new Intl.NumberFormat("de-DE");

/**
 * A handle can be a pasted page URL — the only way to name a Facebook page
 * that has no vanity name. Shown, it should read like a name, not a URL.
 */
function displayHandle(handle: string): string {
  if (!/^https?:\/\//i.test(handle)) return `@${handle}`;
  return handle
    .replace(/^https?:\/\/(www\.|m\.)?/i, "")
    .replace(/\/+$/, "")
    .replace(/^facebook\.com\/people\/([^/]+)\/\d+$/i, "$1 (fb)");
}

export async function AccountsTab({
  personaId,
  canEdit = false,
}: {
  personaId: string;
  canEdit?: boolean;
}) {
  const supabase = await createClient();

  const [{ data: accounts }, { data: metrics }, { data: reels }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, handle, platform, status, telegram_thread_id, posts_per_day, manager_username"
        )
        .eq("persona_id", personaId)
        // Handle as a tiebreaker, or two accounts on the same platform swap
        // places between loads and the card you were about to click moves.
        .order("platform")
        .order("handle"),
      supabase
        .from("account_metrics")
        .select("account_id, captured_at, followers, needs_review, source")
        .eq("persona_id", personaId)
        .order("captured_at", { ascending: false }),
      supabase
        .from("reel_metrics")
        .select(
          "account_id, captured_at, position, request_id, asset_id, views, likes, comments, shares, caption, needs_review, shortcode, post_url, posted_at, source, tile_path"
        )
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
  // The finished cut per request, so a tile can show the actual reel rather
  // than just its name.
  const clips = new Map<
    string,
    { path: string; thumb: string | null; mime: string | null }
  >();
  const allPosted: { requestId: string; at: number }[] = [];
  postedByAccount.forEach((list) => allPosted.push(...list));
  const requestIds = Array.from(new Set(allPosted.map((p) => p.requestId)));
  if (requestIds.length) {
    const { data: reqs } = await supabase
      .from("content_requests")
      .select("id, title")
      .in("id", requestIds);
    for (const r of reqs ?? []) titles.set(r.id, r.title);

    const { data: cuts } = await supabase
      .from("content_assets")
      .select("request_id, file_path, thumbnail_path, mime_type, uploaded_at")
      .in("request_id", requestIds)
      .eq("stage", "edited")
      .order("uploaded_at", { ascending: false });
    for (const c of cuts ?? []) {
      if (!c.request_id || !c.file_path) continue;
      if (clips.has(c.request_id)) continue; // newest wins
      clips.set(c.request_id, {
        path: c.file_path,
        thumb: c.thumbnail_path,
        mime: c.mime_type,
      });
    }
  }

  // Signing is metadata only and costs no egress — the bytes are only
  // fetched if someone presses play, which is why the poster carries the
  // thumbnail and the video preloads nothing.
  const signed = new Map<string, string>();
  const toSign = new Set<string>();
  clips.forEach((c) => {
    toSign.add(c.path);
    if (c.thumb) toSign.add(c.thumb);
  });
  if (toSign.size > 0) {
    const { data: urls } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(Array.from(toSign), 3600);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  // Once the scrape has reached an account, only its rows count; mixing in
  // the screenshot readings would put the same reel in twice under two keys.
  const scrapedAccounts = new Set(
    (reels ?? []).filter((r) => r.source === "scrape").map((r) => r.account_id)
  );
  const reelKey = (r: {
    shortcode: string | null;
    asset_id: string | null;
    request_id: string | null;
    account_id: string | null;
    captured_at: string;
    position: number;
  }) =>
    r.shortcode ??
    r.asset_id ??
    r.request_id ??
    `${r.account_id}|${r.captured_at}|${r.position}`;

  const rows = (accounts ?? []).map((a, i) => {
    const followerRows = (metrics ?? []).filter(
      (m) =>
        m.account_id === a.id &&
        !m.needs_review &&
        m.followers != null &&
        (!scrapedAccounts.has(a.id) || m.source === "scrape")
    );
    const latest = followerRows[0];
    const previous = followerRows.find(
      (m) =>
        latest &&
        new Date(m.captured_at).getTime() <
          new Date(latest.captured_at).getTime() - 12 * 60 * 60 * 1000
    );

    // A reel is seen again in every screenshot for weeks, drifting one
    // place further back each time. Keyed on the reel itself, the newest
    // reading wins and the same video is one row rather than ten. Tiles we
    // couldn't identify fall back to their position within one capture, so
    // they at least don't merge with each other.
    const mine = (reels ?? []).filter(
      (r) => r.account_id === a.id && (!scrapedAccounts.has(a.id) || r.source === "scrape")
    );
    // Newest reading per reel, and the reading from at least half a day
    // earlier, so each tile can say how far it moved since yesterday.
    const latestPerReel = new Map<string, (typeof mine)[number]>();
    const earlierPerReel = new Map<string, (typeof mine)[number]>();
    for (const r of mine) {
      const key = reelKey(r);
      const seen = latestPerReel.get(key);
      if (!seen || r.captured_at > seen.captured_at) latestPerReel.set(key, r);
    }
    for (const r of mine) {
      const key = reelKey(r);
      const latest = latestPerReel.get(key)!;
      const age = new Date(latest.captured_at).getTime() - new Date(r.captured_at).getTime();
      if (age < 12 * 60 * 60 * 1000) continue;
      const seen = earlierPerReel.get(key);
      if (!seen || r.captured_at > seen.captured_at) earlierPerReel.set(key, r);
    }
    // What "doing well" means on this account: well above its own middle.
    // Median rather than mean, so one runaway reel does not make every
    // other one look bad.
    const viewList = Array.from(latestPerReel.values())
      .map((r) => r.views)
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => a - b);
    const median =
      viewList.length === 0
        ? 0
        : viewList.length % 2
          ? viewList[(viewList.length - 1) / 2]
          : (viewList[viewList.length / 2 - 1] + viewList[viewList.length / 2]) / 2;

    const tiles = Array.from(latestPerReel.entries())
      .sort(([, x], [, y]) => {
        // Newest post first when we know when it went up; views otherwise.
        if (x.posted_at && y.posted_at) return x.posted_at < y.posted_at ? 1 : -1;
        return (y.views ?? 0) - (x.views ?? 0);
      })
      .map(([key, r]) => {
        const requestId = r.request_id ?? "";
        const clip = clips.get(requestId);
        const earlier = earlierPerReel.get(key);
        const engagement =
          r.views && r.views > 0
            ? ((r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0)) / r.views
            : null;
        return {
          key,
          position: r.position,
          views: r.views,
          viewsDelta:
            r.views != null && earlier?.views != null ? r.views - earlier.views : null,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          engagement,
          caption: r.caption,
          postUrl: r.post_url,
          postedAt: r.posted_at,
          // The platform's own cover for the post — the picture when there
          // is no cut of ours to play.
          cover: r.source === "scrape" ? r.tile_path : null,
          title: titles.get(requestId) ?? null,
          // Times the account's median. 2× is doing well, 5× is a hit.
          lift: r.views != null && median > 0 ? r.views / median : null,
          seenAt: r.captured_at,
          src: clip ? (signed.get(clip.path) ?? null) : null,
          poster: clip?.thumb ? (signed.get(clip.thumb) ?? null) : null,
        };
      });

    return {
      ...a,
      tone: SHARE_TONE[i % SHARE_TONE.length],
      followers: latest?.followers ?? null,
      followerDelta:
        latest?.followers != null && previous?.followers != null
          ? latest.followers - previous.followers
          : null,
      lastSeen: latest?.captured_at ?? tiles[0]?.seenAt ?? null,
      tiles,
      // Latest known value per reel, so a reel seen ten times counts once.
      views: tiles.reduce((sum, t) => sum + (t.views ?? 0), 0),
      uploads: tiles.length,
    };
  });

  // The summary is about the accounts being worked. One that posts nothing
  // — the model's own page with 138k followers, kept for reference — would
  // otherwise be the whole chart: every other line a flat floor under it,
  // and a step the size of a cliff on the day it was first read.
  const posting = rows.filter((r) => Number(r.posts_per_day ?? 0) > 0);
  const parked = rows.filter((r) => Number(r.posts_per_day ?? 0) === 0);
  const postingIds = new Set(posting.map((r) => r.id));
  const totalViews = posting.reduce((a, r) => a + r.views, 0);
  const totalFollowers = posting.reduce((a, r) => a + (r.followers ?? 0), 0);

  // Views only, as asked — no follower stand-in. Until the first reel grid
  // is read this is empty, and saying so is more use than a donut of
  // followers wearing a views label.
  const share = posting
    .filter((r) => r.views > 0)
    .map((r) => ({ label: displayHandle(r.handle), value: r.views, color: r.tone }));

  // Each screenshot is a reading of the whole account, not an increment, so
  // a day's figure is the newest reading per account summed across accounts.
  // Adding the readings up would count the same followers again every
  // morning and draw a rising curve out of a flat account.
  const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  const seriesFrom = (
    entries: { captured_at: string; account_id: string | null; value: number }[],
    within: "sum" | "last"
  ) => {
    const perDay = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (!e.account_id) continue;
      const day = dayKey(e.captured_at);
      const accounts = perDay.get(day) ?? new Map<string, number>();
      accounts.set(
        e.account_id,
        within === "sum"
          ? (accounts.get(e.account_id) ?? 0) + e.value
          : Math.max(accounts.get(e.account_id) ?? 0, e.value)
      );
      perDay.set(day, accounts);
    }
    return Array.from(perDay.entries())
      .map(([day, accounts]) => ({
        t: new Date(day).getTime(),
        value: Array.from(accounts.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.t - b.t);
  };

  // Views over time, counted per reel: the newest reading of each reel on
  // or before a given day, summed. Counting per screenshot instead would
  // double a day where two grids arrived and would drop reels that simply
  // weren't in the latest one.
  const viewDays = Array.from(
    new Set(
      (reels ?? [])
        .filter((r) => !r.needs_review && r.views != null)
        .map((r) => dayKey(r.captured_at))
    )
  ).sort();
  const viewSeries = viewDays.map((day) => {
    const upto = new Date(`${day}T23:59:59.999Z`).getTime();
    const latest = new Map<string, { at: number; views: number }>();
    for (const r of reels ?? []) {
      if (r.needs_review || r.views == null || !r.account_id) continue;
      if (!postingIds.has(r.account_id)) continue;
      const at = new Date(r.captured_at).getTime();
      if (at > upto) continue;
      if (scrapedAccounts.has(r.account_id) && r.source !== "scrape") continue;
      const key = reelKey(r);
      const seen = latest.get(key);
      if (!seen || at > seen.at) latest.set(key, { at, views: Number(r.views) });
    }
    let total = 0;
    latest.forEach((v) => (total += v.views));
    return { t: new Date(day).getTime(), value: total };
  });

  // One follower line per posting account rather than a sum. Summed, the
  // first reading of a new account is a step in the total; apart, it is a
  // new line starting on that day, which is what happened.
  const followerLines = posting.map((acc, i) => ({
    key: `followers-${acc.id}`,
    label: displayHandle(acc.handle),
    color: LINE_TONE[(i + 1) % LINE_TONE.length],
    points: seriesFrom(
      (metrics ?? [])
        .filter(
          (m) =>
            m.account_id === acc.id &&
            !m.needs_review &&
            m.followers != null &&
            (!scrapedAccounts.has(acc.id) || m.source === "scrape")
        )
        .map((m) => ({
          captured_at: m.captured_at,
          account_id: m.account_id,
          value: Number(m.followers),
        })),
      "last"
    ),
  }));

  const fmtAgo = (iso: string | null) => {
    if (!iso) return "not read yet";
    const h = (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000);
    if (h < 1) return "just now";
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  return (
    <div className="space-y-5">
      {canEdit && <AccountsActionsBar />}

      {/* Summary */}
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-medium">Accounts summarized</h2>
        <div className="mt-4 flex flex-wrap gap-8">
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
          {parked.length > 0 && (
            <p className="self-end text-[11px] text-muted-foreground">
              Posting accounts only.{" "}
              {parked.map((r) => displayHandle(r.handle)).join(", ")} (0 reels a day) counted
              on its own card.
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              All views comparison
            </h3>
            {share.length > 0 ? (
              <PipelineDonut
                segments={share}
                centerLabel="views"
                centerValue={nf.format(totalViews)}
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border/40 px-4 text-center text-xs text-muted-foreground">
                No views yet — the daily scrape fills this in.
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              Engagement over time
            </h3>
            <TrendChart
              series={[
                {
                  key: "views",
                  label: "Views",
                  color: "text-purple-400",
                  points: viewSeries,
                },
                ...followerLines,
              ]}
            />
          </div>
        </div>
      </div>

      {/* One card per account */}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  PLATFORM_STYLE[r.platform]?.bg ?? "bg-muted"
                }`}
                title={r.platform}
              >
                <PlatformGlyph platform={r.platform} className="h-4 w-4 fill-white" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayHandle(r.handle)}</p>
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

          <AccountControls
            accountId={r.id}
            handle={r.handle}
            perDay={Number(r.posts_per_day ?? 0)}
            manager={r.manager_username}
            editable={canEdit}
          />

          {r.tiles.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Nothing read from this account yet — the daily scrape fills this
              row. A private account shows followers only.
            </p>
          ) : (
            <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {r.tiles.map((t) => (
                <div key={t.key} className="w-32 shrink-0">
                  <div
                    className={`relative aspect-[9/16] overflow-hidden rounded-xl border bg-muted/30 ${
                      t.lift != null && t.lift >= 5
                        ? "border-amber-400 ring-2 ring-amber-400/60"
                        : t.lift != null && t.lift >= 2
                          ? "border-emerald-400 ring-2 ring-emerald-400/50"
                          : "border-border/40"
                    }`}
                  >
                    {t.lift != null && t.lift >= 2 && (
                      <span
                        className={`absolute left-1.5 top-1.5 z-10 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-black ${
                          t.lift >= 5 ? "bg-amber-400" : "bg-emerald-400"
                        }`}
                        title={`${t.lift.toFixed(1)}× this account's median views`}
                      >
                        {t.lift >= 5 ? "🔥" : "▲"} {t.lift.toFixed(1)}×
                      </span>
                    )}
                    {t.src ? (
                      <video
                        src={t.src}
                        poster={t.poster ?? undefined}
                        controls
                        playsInline
                        // Nothing is fetched until play — a row of reels
                        // would otherwise cost hundreds of megabytes of
                        // egress just by being on screen.
                        preload="none"
                        className="h-full w-full bg-black object-cover"
                      />
                    ) : t.cover ? (
                      <ReelCover src={t.cover} href={t.postUrl} fallback="no cut in the vault" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
                        no cut in the vault
                      </div>
                    )}

                  </div>
                  <p className="mt-1.5 truncate text-xs font-medium">
                    {t.postUrl ? (
                      <a
                        href={t.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                        title="Open on the platform"
                      >
                        {t.title ?? (
                          <span className="text-muted-foreground">
                            {t.caption ?? "untitled post"}
                          </span>
                        )}
                      </a>
                    ) : (
                      t.title ?? (
                        <span className="text-muted-foreground">
                          {t.caption ?? "not in the app"}
                        </span>
                      )
                    )}
                  </p>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="tabular-nums">
                      ▶ {t.views != null ? nf.format(t.views) : "—"}
                      {t.viewsDelta != null && t.viewsDelta !== 0 && (
                        <span
                          className={`ml-1 ${t.viewsDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}
                          title="since the previous reading"
                        >
                          {t.viewsDelta > 0 ? "+" : ""}
                          {nf.format(t.viewsDelta)}
                        </span>
                      )}
                    </span>
                    {t.engagement != null && (
                      <span
                        className="tabular-nums text-muted-foreground"
                        title="likes + comments + shares, per view"
                      >
                        {(t.engagement * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 text-[10px] tabular-nums text-muted-foreground">
                    {t.likes != null && <span>♥ {nf.format(t.likes)}</span>}
                    {t.comments != null && <span>💬 {nf.format(t.comments)}</span>}
                    {t.shares != null && <span>↗ {nf.format(t.shares)}</span>}
                    {t.postedAt && (
                      <span className="ml-auto">
                        {new Date(t.postedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
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
