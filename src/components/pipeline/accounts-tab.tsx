import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accountLabel as displayHandle,
  computeAnalytics,
  type PeriodKey,
} from "@/lib/account-analytics";
import { ViewsOverTime } from "@/components/pipeline/analytics/views-over-time";
import { ViewDistribution } from "@/components/pipeline/analytics/view-distribution";
import { MomentumChart } from "@/components/pipeline/analytics/momentum-chart";
import { AccountTable } from "@/components/pipeline/analytics/account-table";
import {
  EngagementSection,
  KpiRow,
  PeriodSelector,
  PerformanceList,
} from "@/components/pipeline/analytics/sections";
import { AccountsActionsBar } from "@/components/pipeline/accounts-actions-bar";
import { AccountBoard, type AccountTileData } from "@/components/pipeline/account-board";
import type { Posting } from "@/components/pipeline/posting-calendar";
import { berlinDay } from "@/lib/berlin-day";

/**
 * Accounts tab: the whole operation summarised, then one tile per account
 * that opens onto the reels running on it.
 *
 * The numbers come from a daily scrape of each account on its platform
 * (account-scrape.ts): followers, and the latest posts with views, likes,
 * comments and — on Facebook — shares. Every post is keyed on the
 * platform's own id, so a reel is one row however many days it is seen,
 * and a day-over-day change is the same post read twice. Profile pictures
 * and covers are copied into our own storage by the scrape, because the
 * platforms' own addresses for them expire within days.
 *
 * Rows from the older screenshot pipeline are still in the tables and are
 * used only for an account the scrape has never reached.
 */

const DAY = 86_400_000;

export async function AccountsTab({
  personaId,
  canEdit = false,
  period = "30d",
}: {
  personaId: string;
  canEdit?: boolean;
  period?: PeriodKey;
}) {
  const supabase = await createClient();

  const [{ data: accounts }, { data: metrics }, { data: reels }, { data: slots }] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, handle, display_name, platform, status, telegram_thread_id, posts_per_day, trial_reels_per_day, stories_per_day, manager_username, avatar_path, sort_order, linked_account_id"
      )
      .eq("persona_id", personaId)
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
        "account_id, captured_at, position, request_id, asset_id, views, likes, comments, shares, caption, needs_review, shortcode, post_url, posted_at, source, tile_path, cover_path"
      )
      .eq("persona_id", personaId)
      .order("captured_at", { ascending: false }),
    supabase
      .from("schedule_slots")
      .select("account_id, request_id, posted_at, scheduled_for")
      .eq("persona_id", personaId)
      .eq("status", "posted"),
  ]);

  // Reels already in Trial-Maxxing, so their tile links there.
  const { data: trialRows } = await supabase
    .from("trials")
    .select("id, account_id, shortcode")
    .eq("persona_id", personaId)
    .neq("status", "archived");
  const trialOf = new Map((trialRows ?? []).map((t) => [`${t.account_id}|${t.shortcode}`, t.id]));

  // Auto-posting: what is planned per account, and which are connected.
  // Before migration 00062 neither is there; the board shows none of it.
  const [autoRes, connRes] = await Promise.all([
    supabase
      .from("schedule_slots")
      .select("account_id, scheduled_for, status, publish_state, posted_at")
      .eq("persona_id", personaId)
      .eq("auto_publish", true)
      .gte("scheduled_for", new Date(Date.now() - 8 * DAY).toISOString()),
    createAdminClient().from("ig_connections").select("account_id").eq("persona_id", personaId),
  ]);
  const autoSlots = autoRes.error ? [] : autoRes.data ?? [];
  const connected = new Set((connRes.error ? [] : connRes.data ?? []).map((c) => c.account_id));
  const autopostOf = (accountId: string): AccountTileData["autopost"] => {
    const mine = autoSlots.filter((s) => s.account_id === accountId);
    if (!connected.has(accountId) && mine.length === 0) return null;
    const now = Date.now();
    const ahead = mine
      .filter((s) => s.status === "scheduled" && s.publish_state !== "failed" && new Date(s.scheduled_for).getTime() > now - 10 * 60_000)
      .map((s) => s.scheduled_for)
      .sort();
    return {
      connected: connected.has(accountId),
      scheduled: ahead.length,
      next: ahead[0] ?? null,
      until: ahead[ahead.length - 1] ?? null,
      failed: mine.filter((s) => s.publish_state === "failed").length,
      posted7: mine.filter((s) => s.status === "posted" && s.posted_at && now - new Date(s.posted_at).getTime() < 7 * DAY).length,
    };
  };

  // Every Trial-Maxxing take by its job, and the account it is for: a reel
  // made from one counts as a trial reel on the posting calendar, archived
  // trials included — what was posted stays posted.
  const { data: allTrials } = await supabase.from("trials").select("id, account_id").eq("persona_id", personaId);
  const trialAccount = new Map((allTrials ?? []).map((t) => [t.id, t.account_id as string | null]));
  // Stories, by the day they went up. Before the first one was read no day
  // is held to them — there was nothing reading them yet.
  const { data: storyRows } = await supabase
    .from("account_stories")
    .select("account_id, taken_at, seen_at")
    .eq("persona_id", personaId)
    .gte("taken_at", new Date(Date.now() - 120 * DAY).toISOString());
  const storiesSince = (storyRows ?? []).reduce<string | null>((min, r) => {
    const k = berlinDay(r.seen_at);
    return !min || k < min ? k : min;
  }, null);

  const trialRequestAccount = new Map<string, string | null>();
  if (trialAccount.size) {
    const { data: cells } = await supabase
      .from("trial_cells")
      .select("trial_id, request_id")
      .in("trial_id", Array.from(trialAccount.keys()))
      .not("request_id", "is", null);
    for (const c of cells ?? []) if (c.request_id) trialRequestAccount.set(c.request_id, trialAccount.get(c.trial_id) ?? null);
  }

  // Who runs each account, by name. Profiles are read with the service
  // key: a VA's own profile row is not visible to every other member.
  const managers = Array.from(
    new Set((accounts ?? []).map((a) => a.manager_username?.toLowerCase()).filter((x): x is string => !!x))
  );
  const nameOf = new Map<string, string>();
  if (managers.length) {
    const { data: people } = await createAdminClient()
      .from("user_profiles")
      .select("telegram_username, full_name")
      .not("telegram_username", "is", null);
    for (const p of people ?? []) {
      const u = p.telegram_username?.replace(/^@/, "").toLowerCase();
      if (u && managers.includes(u) && p.full_name) nameOf.set(u, p.full_name);
    }
  }

  // Our reels by request: the title gives the number, the newest edited
  // cut is what plays when a tile is clicked.
  const requestIds = Array.from(
    new Set(
      [...(slots ?? []).map((s) => s.request_id), ...(reels ?? []).map((r) => r.request_id)].filter(
        (x): x is string => !!x
      )
    )
  );
  const titles = new Map<string, string>();
  const clips = new Map<string, { path: string; thumb: string | null }>();
  if (requestIds.length) {
    const [{ data: reqs }, { data: cuts }] = await Promise.all([
      supabase.from("content_requests").select("id, title").in("id", requestIds),
      supabase
        .from("content_assets")
        .select("request_id, file_path, thumbnail_path, uploaded_at")
        .in("request_id", requestIds)
        .eq("stage", "edited")
        .order("uploaded_at", { ascending: false }),
    ]);
    for (const r of reqs ?? []) titles.set(r.id, r.title);
    for (const c of cuts ?? []) {
      if (!c.request_id || !c.file_path || clips.has(c.request_id)) continue;
      clips.set(c.request_id, { path: c.file_path, thumb: c.thumbnail_path });
    }
  }

  // Once the scrape has reached an account, only its rows count; mixing in
  // the screenshot readings would put the same reel in twice under two keys.
  const scrapedAccounts = new Set((reels ?? []).filter((r) => r.source === "scrape").map((r) => r.account_id));
  type ReelRow = NonNullable<typeof reels>[number];
  const reelKey = (r: ReelRow) =>
    r.shortcode ?? r.asset_id ?? r.request_id ?? `${r.account_id}|${r.captured_at}|${r.position}`;

  // Every path the page will show, signed in one go. Signing is metadata
  // only; the bytes move when something is actually looked at.
  const toSign = new Set<string>();
  for (const a of accounts ?? []) if (a.avatar_path) toSign.add(a.avatar_path);
  for (const r of reels ?? []) if (r.cover_path) toSign.add(r.cover_path);
  clips.forEach((c) => {
    toSign.add(c.path);
    if (c.thumb) toSign.add(c.thumb);
  });
  const signed = new Map<string, string>();
  const paths = Array.from(toSign);
  for (let i = 0; i < paths.length; i += 500) {
    const { data: urls } = await supabase.storage.from("content-assets").createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const sign = (p: string | null | undefined) => (p ? signed.get(p) ?? null : null);

  const now = Date.now();
  const rows = (accounts ?? []).map((a) => {
    const followerRows = (metrics ?? []).filter((m) => m.account_id === a.id && !m.needs_review && m.followers != null);
    const latest = followerRows[0];
    const previous = followerRows.find(
      (m) => latest && new Date(m.captured_at).getTime() < new Date(latest.captured_at).getTime() - 12 * 3600_000
    );

    const mine = (reels ?? []).filter(
      (r) => r.account_id === a.id && (!scrapedAccounts.has(a.id) || r.source === "scrape")
    );
    // Newest reading per reel, and the reading from at least half a day
    // before it, so each reel can say how far it moved since.
    const latestPerReel = new Map<string, ReelRow>();
    const earlierPerReel = new Map<string, ReelRow>();
    const coverOf = new Map<string, string>();
    for (const r of mine) {
      const key = reelKey(r);
      const seen = latestPerReel.get(key);
      if (!seen || r.captured_at > seen.captured_at) latestPerReel.set(key, r);
      if (r.cover_path && !coverOf.has(key)) coverOf.set(key, r.cover_path);
    }
    for (const r of mine) {
      const key = reelKey(r);
      const last = latestPerReel.get(key)!;
      if (new Date(last.captured_at).getTime() - new Date(r.captured_at).getTime() < 12 * 3600_000) continue;
      const seen = earlierPerReel.get(key);
      if (!seen || r.captured_at > seen.captured_at) earlierPerReel.set(key, r);
    }
    // "Doing well" means well above this account's own middle. Median, so
    // one runaway reel does not make every other one look bad.
    const viewList = Array.from(latestPerReel.values())
      .map((r) => r.views)
      .filter((v): v is number => v != null && v > 0)
      .sort((x, y) => x - y);
    const median =
      viewList.length === 0
        ? 0
        : viewList.length % 2
          ? viewList[(viewList.length - 1) / 2]
          : (viewList[viewList.length / 2 - 1] + viewList[viewList.length / 2]) / 2;

    const tiles = Array.from(latestPerReel.entries())
      .sort(([, x], [, y]) => {
        if (x.posted_at && y.posted_at) return x.posted_at < y.posted_at ? 1 : -1;
        if (x.posted_at) return -1;
        if (y.posted_at) return 1;
        return (y.views ?? 0) - (x.views ?? 0);
      })
      .map(([key, r]) => {
        const clip = r.request_id ? clips.get(r.request_id) : undefined;
        const earlier = earlierPerReel.get(key);
        const title = r.request_id ? titles.get(r.request_id) ?? null : null;
        const number = title ? (title.match(/#\s*\d+/)?.[0].replace(/\s+/g, "") ?? title) : null;
        // The cover, from the most to the least lasting: stored by the
        // scrape, the thumbnail of our own cut, the platform's address
        // while it is fresh enough to still work.
        const fresh = now - new Date(r.captured_at).getTime() < 3 * DAY;
        const cover =
          sign(coverOf.get(key)) ??
          sign(clip?.thumb) ??
          (r.tile_path && fresh && r.source === "scrape" ? `/api/cover?u=${encodeURIComponent(r.tile_path)}` : null);
        const lift = r.views != null && median > 0 ? r.views / median : null;
        return {
          key,
          number,
          caption: r.caption,
          cover,
          video: sign(clip?.path),
          postUrl: r.post_url,
          postedAt: r.posted_at,
          views: r.views,
          viewsDelta: r.views != null && earlier?.views != null ? r.views - earlier.views : null,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          engagement:
            r.views && r.views > 0 ? ((r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0)) / r.views : null,
          lift,
          shortcode: r.source === "scrape" ? r.shortcode : null,
          trialId: r.shortcode ? trialOf.get(`${a.id}|${r.shortcode}`) ?? null : null,
          seenAt: r.captured_at,
        };
      });

    // Day by day, what went up: the scraped reels by the day they were
    // posted, trial takes apart. A trial reel can be posted as an Instagram
    // trial, which never shows on the profile, so a take marked posted in
    // the app counts on its day even when the scrape never sees it.
    const days: Posting["days"] = {};
    const bump = (iso: string, kind: "r" | "t" | "s") => {
      const k = berlinDay(iso);
      (days[k] ??= { r: 0, t: 0, s: 0 })[kind]++;
    };
    const trialSeen = new Set<string>();
    let since: string | null = null;
    latestPerReel.forEach((r) => {
      if (!r.posted_at) return;
      const k = berlinDay(r.posted_at);
      if (!since || k < since) since = k;
      if (r.request_id && trialRequestAccount.has(r.request_id)) {
        trialSeen.add(r.request_id);
        bump(r.posted_at, "t");
      } else bump(r.posted_at, "r");
    });
    for (const s of slots ?? []) {
      if (!s.request_id || trialSeen.has(s.request_id) || !trialRequestAccount.has(s.request_id)) continue;
      if ((s.account_id ?? trialRequestAccount.get(s.request_id)) !== a.id) continue;
      const at = s.posted_at ?? s.scheduled_for;
      if (!at) continue;
      trialSeen.add(s.request_id);
      bump(at, "t");
    }

    for (const st of storyRows ?? []) if (st.account_id === a.id) bump(st.taken_at, "s");

    const weekAgo = now - 7 * DAY;
    const inWeek = (t: (typeof tiles)[number]) => t.postedAt != null && new Date(t.postedAt).getTime() >= weekAgo;
    const isHit = (t: (typeof tiles)[number]) => t.lift != null && t.lift >= 5;
    const isGood = (t: (typeof tiles)[number]) => t.lift != null && t.lift >= 2 && t.lift < 5;
    const lastSeen = latest?.captured_at ?? tiles.map((t) => t.seenAt).sort().pop() ?? null;
    const handle = a.handle.replace(/^@/, "");
    return {
      a,
      latestFollowers: latest?.followers ?? null,
      followerDelta:
        latest?.followers != null && previous?.followers != null ? latest.followers - previous.followers : null,
      lastSeen,
      tiles,
      views: tiles.reduce((sum, t) => sum + (t.views ?? 0), 0),
      viewsDelta: tiles.reduce((sum, t) => sum + Math.max(0, t.viewsDelta ?? 0), 0),
      hitsWeek: tiles.filter((t) => isHit(t) && inWeek(t)).length,
      hitsTotal: tiles.filter(isHit).length,
      goodWeek: tiles.filter((t) => isGood(t) && inWeek(t)).length,
      goodTotal: tiles.filter(isGood).length,
      posting: { since, days, until: lastSeen ? berlinDay(lastSeen) : null, storiesSince } as Posting,
      profileUrl: /^https?:\/\//i.test(handle)
        ? handle
        : a.platform === "instagram"
          ? `https://www.instagram.com/${handle}/`
          : a.platform === "facebook"
            ? `https://www.facebook.com/${handle}`
            : null,
    };
  });

  // The summary is about the accounts being worked. One that posts nothing
  // would otherwise be the whole chart: every other line a floor under it.
  // Disabled accounts keep their tile and history, and leave the charts.
  const dead = (r: (typeof rows)[number]) => r.a.status === "dead";
  const posting = rows.filter((r) => !dead(r) && Number(r.a.posts_per_day ?? 0) > 0);
  const parked = rows.filter((r) => !dead(r) && Number(r.a.posts_per_day ?? 0) === 0);
  const disabled = rows.filter(dead);

  const analytics = computeAnalytics(
    posting.map((r) => ({
      id: r.a.id,
      handle: r.a.handle,
      platform: r.a.platform,
      avatar: sign(r.a.avatar_path),
      label: r.a.display_name,
    })),
    reels ?? [],
    metrics ?? [],
    period
  );
  const hasPeriod = period !== "all";
  const statOf = new Map(analytics.accounts.map((s) => [s.id, s]));

  // Freshest reading anyone got; an account two days behind it is stuck.
  const newest = Math.max(0, ...rows.map((r) => (r.lastSeen ? new Date(r.lastSeen).getTime() : 0)));
  const tiles: AccountTileData[] = rows.map((r) => {
    const stat = statOf.get(r.a.id);
    const last = r.lastSeen ? new Date(r.lastSeen).getTime() : 0;
    return {
      id: r.a.id,
      handle: r.a.handle,
      label: r.a.display_name || displayHandle(r.a.handle),
      displayName: r.a.display_name ?? "",
      platform: r.a.platform,
      avatar: sign(r.a.avatar_path),
      color: stat?.color ?? "#71717a",
      manager: r.a.manager_username,
      managerName: r.a.manager_username ? nameOf.get(r.a.manager_username.replace(/^@/, "").toLowerCase()) ?? null : null,
      perDay: Number(r.a.posts_per_day ?? 0),
      trialPerDay: Number(r.a.trial_reels_per_day ?? 0),
      storiesPerDay: Number(r.a.stories_per_day ?? 0),
      posting: r.posting,
      followers: r.latestFollowers,
      followerDelta: r.followerDelta,
      views: r.views,
      viewsDelta: r.viewsDelta,
      reelCount: r.tiles.length,
      hitsWeek: r.hitsWeek,
      hitsTotal: r.hitsTotal,
      goodWeek: r.goodWeek,
      goodTotal: r.goodTotal,
      lastSeen: r.lastSeen,
      // Read before, and not for two days while the others were. An account
      // never read yet is not stuck — its first read is still to come.
      stale: !dead(r) && last > 0 && Number(r.a.posts_per_day ?? 0) > 0 && newest - last > 2 * DAY,
      disabled: dead(r),
      linkedId: r.a.linked_account_id,
      sortOrder: r.a.sort_order,
      profileUrl: r.profileUrl,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      reels: r.tiles.map(({ seenAt, ...t }) => t),
      autopost: r.a.platform === "instagram" ? autopostOf(r.a.id) : null,
    };
  });

  const lines = analytics.accounts.map((s) => ({
    id: s.id,
    label: s.label,
    platform: s.platform,
    color: s.color,
    avatar: s.avatar,
    points: analytics.series.byAccount[s.id],
    seam: analytics.series.seamByAccount[s.id] ?? -1,
    first: analytics.series.firstByAccount[s.id],
    last: analytics.series.lastByAccount[s.id],
  }));

  return (
    <div className="space-y-5">
      {canEdit && <AccountsActionsBar />}

      {/* 1 · The network at a glance */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Accounts</h2>
          <p className="text-[11px] text-muted-foreground">
            {analytics.accounts.length} posting account{analytics.accounts.length === 1 ? "" : "s"}
            {parked.length > 0 && (
              <>
                {" · "}
                {parked.map((r) => r.a.display_name || displayHandle(r.a.handle)).join(", ")} parked (0 reels a day), left out of the charts
              </>
            )}
            {disabled.length > 0 && (
              <>
                {" · "}
                {disabled.map((r) => r.a.display_name || displayHandle(r.a.handle)).join(", ")} disabled, kept at the end of the tiles
              </>
            )}
          </p>
        </div>
        <PeriodSelector period={period} />
      </div>
      <KpiRow kpis={analytics.kpis} hasPeriod={hasPeriod} />
      {hasPeriod && analytics.scrapeSince != null && analytics.start < analytics.scrapeSince && (
        <p className="-mt-2 text-[11px] text-muted-foreground">
          Views gained are counted since the first scrape on{" "}
          {new Date(analytics.scrapeSince).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}. The
          screenshot months before it are drawn dashed in the chart and make no number.
        </p>
      )}

      {/* 2 · Growth, account against account */}
      <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Views over time</h3>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            one line per account · dashed vertical line marks the period start
          </span>
        </div>
        <ViewsOverTime days={analytics.series.days} lines={lines} periodStart={analytics.start} />
      </div>

      {/* 3 · Who and how fast */}
      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-4 text-sm font-medium">View distribution</h3>
          <ViewDistribution
            slices={analytics.accounts.map((s) => ({
              id: s.id,
              label: s.label,
              value: s.views,
              color: s.color,
              platform: s.platform,
              avatar: s.avatar,
            }))}
          />
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            {hasPeriod ? "Views gained in the period" : "All views"}, share per account · Instagram in reds,
            Facebook in blues
          </p>
        </div>
        <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-1 text-sm font-medium">Account momentum</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Size against speed: followers along the bottom, views per follower up the side.
          </p>
          <MomentumChart accounts={analytics.accounts} />
        </div>
      </div>

      {/* 4 · Ranking and interaction */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-4 text-sm font-medium">Account performance</h3>
          <PerformanceList accounts={analytics.accounts} hasPeriod={hasPeriod} />
        </div>
        <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-1 text-sm font-medium">Engagement</h3>
          <p className="mb-4 text-[11px] text-muted-foreground">
            Likes, comments and shares per view — reels {hasPeriod ? "posted in the period" : "on the accounts"}.
          </p>
          <EngagementSection accounts={analytics.accounts} hasPeriod={hasPeriod} />
        </div>
      </div>

      {/* 5 · The numbers */}
      <div className="min-w-0 rounded-2xl border border-border/50 bg-card p-5">
        <h3 className="mb-2 text-sm font-medium">Account table</h3>
        <AccountTable accounts={analytics.accounts} showPeriod={hasPeriod} />
      </div>

      {/* 6 · One tile per account, opening onto its reels */}
      <div className="pt-2">
        <AccountBoard accounts={tiles} canEdit={canEdit} />
      </div>
    </div>
  );
}
