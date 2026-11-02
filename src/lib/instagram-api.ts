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
  handle: string
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
    const pages = await igFetch<{ data?: { instagram_business_account?: { id: string; username?: string } }[] }>(
      `${FB_GRAPH}/me/accounts?${new URLSearchParams({
        fields: "instagram_business_account{id,username}",
        limit: "100",
        access_token: token,
      })}`
    );
    const hit = (pages.data ?? [])
      .map((p) => p.instagram_business_account)
      .find((a) => a?.username?.toLowerCase() === want);
    if (hit) {
      igUserId = hit.id;
      username = hit.username ?? null;
    }
    const dbg = await igFetch<{ data?: { expires_at?: number } }>(
      `${FB_GRAPH}/debug_token?${new URLSearchParams({ input_token: token, access_token: token })}`
    ).catch(() => null);
    const exp = dbg?.data?.expires_at;
    expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
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
