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
 * A feed post: one picture, or a carousel of up to ten. Instagram takes
 * JPEG only, between 4:5 and 1.91:1 — the planner converts on upload.
 */
export async function createFeedContainer(
  igUserId: string,
  token: string,
  p: { imageUrls: string[]; caption: string | null }
): Promise<string> {
  const host = graphFor(token);
  if (p.imageUrls.length === 1) {
    const form = new URLSearchParams({ image_url: p.imageUrls[0], access_token: token });
    if (p.caption) form.set("caption", p.caption);
    return (await igFetch<{ id: string }>(`${host}/${igUserId}/media`, { method: "POST", body: form })).id;
  }
  const children: string[] = [];
  for (const url of p.imageUrls) {
    const form = new URLSearchParams({ image_url: url, is_carousel_item: "true", access_token: token });
    children.push((await igFetch<{ id: string }>(`${host}/${igUserId}/media`, { method: "POST", body: form })).id);
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
