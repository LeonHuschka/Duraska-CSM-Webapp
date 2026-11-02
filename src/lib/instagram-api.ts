import "server-only";

/**
 * Instagram's own API, with Instagram Login: an account connects once in
 * the planner, and its reels are then published through it.
 *
 * Needs INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET — the Instagram app id
 * and secret from the Meta app's "Instagram API with Instagram Login"
 * settings, not the Meta app's own. The callback below must be listed
 * there as a valid OAuth redirect URI.
 */
const GRAPH = "https://graph.instagram.com/v23.0";
export const IG_REDIRECT = "https://csm-duraskastudios.space/api/instagram/callback";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export function igConfigured(): boolean {
  return !!process.env.INSTAGRAM_APP_ID && !!process.env.INSTAGRAM_APP_SECRET;
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    redirect_uri: IG_REDIRECT,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
    // Ask every time, so the right account is picked even when the
    // browser is logged in to another one.
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
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

/** The code from the redirect → a long-lived token (60 days) and the account behind it. */
export async function connectWithCode(code: string): Promise<{
  token: string;
  expiresAt: string | null;
  igUserId: string;
  username: string | null;
}> {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
    grant_type: "authorization_code",
    redirect_uri: IG_REDIRECT,
    code,
  });
  const short = await igFetch<{ access_token?: string; data?: { access_token: string }[] }>(
    "https://api.instagram.com/oauth/access_token",
    { method: "POST", body: form }
  );
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error("Instagram gave no token");
  const long = await igFetch<{ access_token: string; expires_in?: number }>(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
      access_token: shortToken,
    })}`
  );
  const me = await igFetch<{ user_id?: string; id?: string; username?: string }>(
    `${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: long.access_token })}`
  );
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
    igUserId: String(me.user_id ?? me.id),
    username: me.username ?? null,
  };
}

/** Another 60 days. Works once the token is a day old and still valid. */
export async function refreshToken(token: string): Promise<{ token: string; expiresAt: string | null }> {
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
  const res = await igFetch<{ id: string }>(`${GRAPH}/${igUserId}/media`, { method: "POST", body: form });
  return res.id;
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export async function containerStatus(
  containerId: string,
  token: string
): Promise<{ code: ContainerStatus; detail: string | null }> {
  const res = await igFetch<{ status_code: ContainerStatus; status?: string }>(
    `${GRAPH}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`
  );
  return { code: res.status_code, detail: res.status ?? null };
}

/** Step two: the processed video goes live. */
export async function publishContainer(igUserId: string, containerId: string, token: string): Promise<string> {
  const form = new URLSearchParams({ creation_id: containerId, access_token: token });
  const res = await igFetch<{ id: string }>(`${GRAPH}/${igUserId}/media_publish`, { method: "POST", body: form });
  return res.id;
}

export async function mediaPermalink(mediaId: string, token: string): Promise<string | null> {
  const res = await igFetch<{ permalink?: string }>(
    `${GRAPH}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`
  ).catch(() => null);
  return res?.permalink ?? null;
}

/** The newest post of the account — for a publish whose answer got lost. */
export async function latestMedia(igUserId: string, token: string): Promise<{ id: string; permalink: string | null } | null> {
  const res = await igFetch<{ data?: { id: string; permalink?: string }[] }>(
    `${GRAPH}/${igUserId}/media?${new URLSearchParams({ fields: "id,permalink", limit: "1", access_token: token })}`
  ).catch(() => null);
  const m = res?.data?.[0];
  return m ? { id: m.id, permalink: m.permalink ?? null } : null;
}
