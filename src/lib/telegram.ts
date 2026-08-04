/**
 * Minimal Telegram Bot API client — only what this app needs.
 *
 * The token lives in TELEGRAM_BOT_TOKEN (server-only, never NEXT_PUBLIC_).
 */

const API = "https://api.telegram.org";

function token(): string | null {
  const raw = process.env.TELEGRAM_BOT_TOKEN;
  if (!raw) return null;
  // Tolerate paste artefacts: stray whitespace/newlines, quotes, or the
  // "bot" prefix people copy along with the URL from the docs.
  return raw.trim().replace(/^["']|["']$/g, "").replace(/^bot/, "") || null;
}

async function call<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; error?: string }> {
  const t = token();
  if (!t) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!json.ok) return { ok: false, error: json.description ?? "unknown error" };
    return { ok: true, result: json.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

export async function sendMessage(opts: {
  chat_id: number | string;
  text: string;
  message_thread_id?: number | null;
  parse_mode?: "HTML" | "Markdown";
  disable_notification?: boolean;
}) {
  return call("sendMessage", {
    chat_id: opts.chat_id,
    text: opts.text,
    ...(opts.message_thread_id ? { message_thread_id: opts.message_thread_id } : {}),
    parse_mode: opts.parse_mode ?? "HTML",
    disable_web_page_preview: true,
    ...(opts.disable_notification ? { disable_notification: true } : {}),
  });
}

/**
 * Put an emoji reaction on a message. Requires the bot to be an admin in
 * the group. Telegram only accepts a fixed set of emoji here.
 */
export async function setMessageReaction(opts: {
  chat_id: number | string;
  message_id: number;
  emoji: string | null; // null clears the reaction
}) {
  return call("setMessageReaction", {
    chat_id: opts.chat_id,
    message_id: opts.message_id,
    reaction: opts.emoji ? [{ type: "emoji", emoji: opts.emoji }] : [],
    is_big: false,
  });
}

export async function deleteMessage(opts: {
  chat_id: number | string;
  message_id: number;
}) {
  return call("deleteMessage", opts);
}

/** Download a Telegram-hosted file (photo/document) as base64. */
export async function downloadFile(
  fileId: string
): Promise<{ base64: string; mime: string } | null> {
  const t = token();
  if (!t) return null;
  const meta = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = meta.result?.file_path;
  if (!meta.ok || !path) return null;
  try {
    const res = await fetch(`${API}/file/bot${t}/${path}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = path.endsWith(".png")
      ? "image/png"
      : path.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

export async function setWebhook(url: string, secret: string) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "message_reaction", "edited_message"],
    drop_pending_updates: true,
  });
}

export async function getWebhookInfo() {
  return call("getWebhookInfo", {});
}

/** Verify the configured token actually belongs to a live bot. */
export async function getMe() {
  return call<{ id: number; username?: string; first_name?: string }>("getMe", {});
}

// ─── Instagram link handling ────────────────────────────────────────────

const IG_URL_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/gi;

/** Extract every Instagram post/reel URL from a message. */
export function extractInstagramLinks(text: string): string[] {
  const out: string[] = [];
  // exec loop rather than matchAll — the tsconfig target predates
  // downlevelIteration for regex iterators.
  const re = new RegExp(IG_URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return Array.from(new Set(out));
}

/**
 * Normalised key for a link so the same reel shared in different forms
 * (with/without query string, /reel/ vs /p/) matches. Keyed on the
 * shortcode, which is the stable part.
 */
export function instagramKey(url: string): string | null {
  const m = url.match(
    /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i
  );
  return m ? m[1] : null;
}

/**
 * Is this reel still on Instagram?
 *
 * A browser user-agent gets a datacenter IP nothing but the login wall —
 * byte for byte the same page whether the post exists or not, which is why
 * this used to answer "unclear" for everything. Crawlers are treated
 * differently: Instagram hands them the Open Graph tags so link previews
 * work, and a removed post has none. So ask as a crawler first, and only
 * fall back to the embed endpoint.
 *
 * `false` is evidence. `null` means "could not tell" and callers must not
 * act on it.
 */
const CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

type Probe = { alive: boolean | null; reason: string };

async function probe(
  url: string,
  ua: string,
  present: string[],
  label: string
): Promise<Probe> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      // Instagram tarpits datacenter IPs: it accepts the connection and
      // then simply never answers. Without this the cron's workers all
      // sit waiting until the function is killed.
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": ua, accept: "text/html", "accept-language": "en-US,en;q=0.9" },
    });
    if (res.status === 404) return { alive: false, reason: `${label}: 404` };
    if ([401, 403, 429].includes(res.status)) {
      return { alive: null, reason: `${label}: blocked (${res.status})` };
    }
    if (!res.ok) return { alive: null, reason: `${label}: http ${res.status}` };

    const html = await res.text();
    if (present.some((m) => html.includes(m))) {
      return { alive: true, reason: `${label}: media present` };
    }
    // Served the wall rather than the post — that tells us nothing about
    // whether the post exists.
    if (/loginForm|"challenge"|accounts\/login/i.test(html)) {
      return { alive: null, reason: `${label}: login wall` };
    }
    return { alive: false, reason: `${label}: no media in a real response` };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      alive: null,
      reason: `${label}: ${timedOut ? "no answer within 8s" : err instanceof Error ? err.message : "fetch failed"}`,
    };
  }
}

export async function checkInstagramAlive(
  url: string
): Promise<{ alive: boolean | null; reason: string }> {
  const code = instagramKey(url);
  if (!code) return { alive: null, reason: "no shortcode in url" };

  const attempts: Probe[] = [];

  // 1. As a crawler, against the post page — this is the path that serves
  //    Open Graph tags to Telegram and Facebook.
  attempts.push(
    await probe(
      `https://www.instagram.com/p/${code}/`,
      CRAWLER_UA,
      ['property="og:video"', 'property="og:image"', 'property="og:title"'],
      "crawler"
    )
  );
  if (attempts[0].alive !== null) return attempts[0];

  // 2. The embed endpoint, which carries shortcode_media only when there is
  //    media to embed.
  attempts.push(
    await probe(
      `https://www.instagram.com/p/${code}/embed/captioned/`,
      BROWSER_UA,
      ["shortcode_media"],
      "embed"
    )
  );
  if (attempts[1].alive !== null) return attempts[1];

  return { alive: null, reason: attempts.map((a) => a.reason).join(" · ") };
}

/** Emoji vocabulary for the pipeline steps. */
export const REACTION = {
  uploaded: "👍", // takes are in the app
  edited: "🔥", // final cut is done
  dead: "💔",
} as const;
