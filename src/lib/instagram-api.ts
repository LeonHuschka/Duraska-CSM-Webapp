import "server-only";

/**
 * Publishing through Meta's API. An account is connected once in the
 * planner by pasting an access token from the Meta app's dashboard.
 *
 * Two kinds of token work: an Instagram token ("IGAA…", Instagram
 * Login) talks to graph.instagram.com, a Facebook token ("EAA…", the
 * Unified / Facebook Login setup new apps get) to graph.facebook.com.
 * The calls are the same on both, only the host differs.
 */
const IG_GRAPH = "https://graph.instagram.com/v23.0";
const FB_GRAPH = "https://graph.facebook.com/v23.0";

function graphFor(token: string): string {
  return token.startsWith("EAA") ? FB_GRAPH : IG_GRAPH;
}

type IgError = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } };

async function igFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as T & IgError & { error_message?: string };
  if (!res.ok || body.error) {
    const e = body.error;
    throw new Error(e?.error_user_msg || e?.message || body.error_message || `Instagram answered ${res.status}`);
  }
  return body;
}

/**
 * A pasted token → the Instagram account behind it, which must be the
 * one asked for. Instagram tokens from the dashboard last 60 days and
 * are renewed by the daily run; Facebook ones carry their own expiry.
 */
export async function connectWithToken(
  rawToken: string,
  handle: string,
  accountId?: string
): Promise<{ token: string; expiresAt: string | null; igUserId: string; username: string }> {
  const token = rawToken.trim();
  const want = handle.replace(/^@/, "").toLowerCase();
  let igUserId: string | null = null;
  let username: string | null = null;
  let expiresAt: string | null = null;

  if (graphFor(token) === IG_GRAPH) {
    const me = await igFetch<{ user_id?: string; id?: string; username?: string }>(
      `${IG_GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`
    );
    igUserId = String(me.user_id ?? me.id);
    username = me.username ?? null;
    expiresAt = new Date(Date.now() + 60 * 86_400_000).toISOString();
  } else {
    // A system-user token does not tell which accounts it was granted, so
    // the account id from the Meta dashboard comes along. User tokens list
    // theirs in their scopes or through their Facebook pages.
    const dbg = await igFetch<{
      data?: { expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] };
    }>(`${FB_GRAPH}/debug_token?${new URLSearchParams({ input_token: token, access_token: token })}`).catch(() => null);
    const exp = dbg?.data?.expires_at;
    expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
    const ids = new Set(
      (dbg?.data?.granular_scopes ?? []).filter((g) => g.scope.startsWith("instagram")).flatMap((g) => g.target_ids ?? [])
    );
    if (accountId?.trim()) ids.add(accountId.trim());
    const pages = await igFetch<{ data?: { instagram_business_account?: { id: string } }[] }>(
      `${FB_GRAPH}/me/accounts?${new URLSearchParams({
        fields: "instagram_business_account{id}",
        limit: "100",
        access_token: token,
      })}`
    ).catch(() => null);
    for (const p of pages?.data ?? []) if (p.instagram_business_account) ids.add(p.instagram_business_account.id);
    for (const id of Array.from(ids)) {
      const acc = await igFetch<{ id: string; username?: string }>(
        `${FB_GRAPH}/${id}?${new URLSearchParams({ fields: "id,username", access_token: token })}`
      ).catch(() => null);
      if (acc?.username?.toLowerCase() === want) {
        igUserId = acc.id;
        username = acc.username;
        break;
      }
      if (acc?.username && !username) username = acc.username;
    }
    if (!igUserId && username) throw new Error(`This token belongs to @${username}, not @${want}`);
    if (!ids.size) {
      // Maybe a Unified-login token Instagram's own API takes.
      const me = await igFetch<{ user_id?: string; id?: string; username?: string }>(
        `${IG_GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`
      ).catch(() => null);
      if (me?.username) throw new Error("This token only works with Instagram's own API — tell Claude");
      throw new Error("Paste the Instagram account ID too — the number under the account in the Meta app");
    }
  }

  if (!igUserId || !username) throw new Error(`This token has no access to @${want}`);
  if (username.toLowerCase() !== want) throw new Error(`This token belongs to @${username}, not @${want}`);
  return { token, expiresAt, igUserId, username };
}

/** Another 60 days. Works once the token is a day old and still valid; Instagram tokens only. */
export async function refreshToken(token: string): Promise<{ token: string; expiresAt: string | null }> {
  if (graphFor(token) === FB_GRAPH) throw new Error("Facebook tokens are not renewed — paste a new one");
  const res = await igFetch<{ access_token: string; expires_in?: number }>(
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    })}`
  );
  return {
    token: res.access_token,
    expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : null,
  };
}

/** Step one: Instagram fetches the video from our storage and processes it. */
export async function createReelContainer(
  igUserId: string,
  token: string,
  p: { videoUrl: string; caption: string | null; shareToFeed: boolean; trial: boolean }
): Promise<string> {
  const form = new URLSearchParams({
    media_type: "REELS",
    video_url: p.videoUrl,
    share_to_feed: String(p.shareToFeed),
    access_token: token,
  });
  if (p.caption) form.set("caption", p.caption);
  // A trial reel goes to non-followers first and joins the profile by
  // itself when it does well.
  if (p.trial) form.set("trial_params", JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }));
  const res = await igFetch<{ id: string }>(`${graphFor(token)}/${igUserId}/media`, { method: "POST", body: form });
  return res.id;
}

/**
 * A feed post: one picture, or a carousel of up to ten pictures and
 * videos. Instagram takes JPEG pictures only, between 4:5 and 1.91:1 —
 * the planner converts on upload. A video in a carousel is processed on
 * its own first; the carousel can only be made once every video is done.
 */
export async function createFeedContainer(
  igUserId: string,
  token: string,
  p: { items: { url: string; video: boolean }[]; caption: string | null; waitUntil: number }
): Promise<string> {
  const host = graphFor(token);
  if (p.items.length === 1 && !p.items[0].video) {
    const form = new URLSearchParams({ image_url: p.items[0].url, access_token: token });
    if (p.caption) form.set("caption", p.caption);
    return (await igFetch<{ id: string }>(`${host}/${igUserId}/media`, { method: "POST", body: form })).id;
  }
  const children: string[] = [];
  const videos: string[] = [];
  for (const it of p.items) {
    const form = new URLSearchParams(
      it.video
        ? { media_type: "VIDEO", video_url: it.url, is_carousel_item: "true", access_token: token }
        : { image_url: it.url, is_carousel_item: "true", access_token: token }
    );
    const id = (await igFetch<{ id: string }>(`${host}/${igUserId}/media`, { method: "POST", body: form })).id;
    children.push(id);
    if (it.video) videos.push(id);
  }
  for (const id of videos) {
    for (;;) {
      const st = await containerStatus(id, token);
      if (st.code === "FINISHED") break;
      if (st.code === "ERROR" || st.code === "EXPIRED") {
        throw new Error(`Instagram could not process a video of the carousel${st.detail ? `: ${st.detail}` : ""}`);
      }
      if (Date.now() > p.waitUntil) throw new Error("Instagram took too long on a video of the carousel — it is tried again");
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  const form = new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), access_token: token });
  if (p.caption) form.set("caption", p.caption);
  return (await igFetch<{ id: string }>(`${host}/${igUserId}/media`, { method: "POST", body: form })).id;
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export async function containerStatus(
  containerId: string,
  token: string
): Promise<{ code: ContainerStatus; detail: string | null }> {
  const res = await igFetch<{ status_code: ContainerStatus; status?: string }>(
    `${graphFor(token)}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`
  );
  return { code: res.status_code, detail: res.status ?? null };
}

/** Step two: the processed video goes live. */
export async function publishContainer(igUserId: string, containerId: string, token: string): Promise<string> {
  const form = new URLSearchParams({ creation_id: containerId, access_token: token });
  const res = await igFetch<{ id: string }>(`${graphFor(token)}/${igUserId}/media_publish`, { method: "POST", body: form });
  return res.id;
}

export async function mediaPermalink(mediaId: string, token: string): Promise<string | null> {
  const res = await igFetch<{ permalink?: string }>(
    `${graphFor(token)}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`
  ).catch(() => null);
  return res?.permalink ?? null;
}

/** The newest post of the account — for a publish whose answer got lost. */
export async function latestMedia(igUserId: string, token: string): Promise<{ id: string; permalink: string | null } | null> {
  const res = await igFetch<{ data?: { id: string; permalink?: string }[] }>(
    `${graphFor(token)}/${igUserId}/media?${new URLSearchParams({ fields: "id,permalink", limit: "1", access_token: token })}`
  ).catch(() => null);
  const m = res?.data?.[0];
  return m ? { id: m.id, permalink: m.permalink ?? null } : null;
}

export type OwnMedia = {
  id: string;
  shortcode: string | null;
  permalink: string | null;
  timestamp: string | null;
  caption: string | null;
  kind: string | null;
  thumbnail: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Why Instagram gave no numbers, when it gave none. */
  insightsError: string | null;
};

/**
 * One of the account's own posts with its numbers, as its owner sees them —
 * trial reels too, which no outside reader gets: they are not on the
 * profile.
 */
export async function ownMedia(mediaId: string, token: string): Promise<OwnMedia | null> {
  const host = graphFor(token);
  const m = await igFetch<{
    id: string;
    shortcode?: string;
    permalink?: string;
    timestamp?: string;
    caption?: string;
    media_product_type?: string;
    media_type?: string;
    thumbnail_url?: string;
    media_url?: string;
    like_count?: number;
    comments_count?: number;
  }>(
    `${host}/${mediaId}?${new URLSearchParams({
      fields: "id,shortcode,permalink,timestamp,caption,media_product_type,media_type,thumbnail_url,media_url,like_count,comments_count",
      access_token: token,
    })}`
  ).catch(() => null);
  if (!m) return null;
  // Views where Instagram has them; a picture without them still has the rest.
  let insightsError: string | null = null;
  const insights = async (metric: string) =>
    igFetch<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
      `${host}/${mediaId}/insights?${new URLSearchParams({ metric, access_token: token })}`
    ).catch((err) => {
      insightsError = err instanceof Error ? err.message : String(err);
      return null;
    });
  const ins = (await insights("views,likes,comments,shares")) ?? (await insights("likes,comments,shares"));
  const val = (name: string) => {
    const d = ins?.data?.find((x) => x.name === name);
    const v = d?.total_value?.value ?? d?.values?.[0]?.value;
    return typeof v === "number" ? v : null;
  };
  return {
    id: m.id,
    shortcode: m.shortcode ?? m.permalink?.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1] ?? null,
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
    caption: m.caption ?? null,
    kind: m.media_product_type ?? m.media_type ?? null,
    thumbnail: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url ?? null : null),
    views: val("views"),
    likes: val("likes") ?? m.like_count ?? null,
    comments: val("comments") ?? m.comments_count ?? null,
    shares: val("shares"),
    insightsError: ins ? null : insightsError,
  };
}

/** The ids of the account's newest posts on its profile. */
export async function recentMediaIds(igUserId: string, token: string, limit = 25): Promise<string[]> {
  const res = await igFetch<{ data?: { id: string }[] }>(
    `${graphFor(token)}/${igUserId}/media?${new URLSearchParams({ fields: "id", limit: String(limit), access_token: token })}`
  ).catch(() => null);
  return (res?.data ?? []).map((m) => m.id);
}
