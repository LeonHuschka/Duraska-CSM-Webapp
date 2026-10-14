import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMetaNetwork } from "@/lib/ip-ranges";

/**
 * The link-in-bio page: who is asking, and should they get the link.
 *
 * Three kinds of visitor reach the page. A fan in Instagram's in-app
 * browser, who should be popped out into Safari or Chrome and sent on. A
 * fan in a real browser, who gets the link straight away. And a crawler —
 * Meta's link scanner first of all — which gets the page with nothing on
 * it, because the destination is never in the HTML and the redirect refuses
 * anything that looks like a machine. A hidden canary link on the page
 * catches the crawlers that pretend to be browsers: no person can click
 * what they cannot see, so whoever follows it is remembered as a bot.
 */
export type FunnelPage = Database["public"]["Tables"]["funnel_pages"]["Row"];

export type Visitor = {
  ua: string;
  hash: string;
  country: string | null;
  referrer: string | null;
  inApp: boolean;
  platform: "ios" | "android" | "other";
  bot: string | null; // the reason, when it is a bot
};

/** What the known crawlers call themselves. Meta's own first. */
const BOT_UA =
  /facebookexternalhit|facebot|meta-externalagent|meta-externalads|instagram\s*bot|threadsbot|twitterbot|linkedinbot|pinterestbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|googlebot|bingbot|yandex|baiduspider|duckduckbot|applebot|petalbot|semrush|ahrefs|mj12bot|dotbot|gptbot|claudebot|ccbot|bytespider|amazonbot|headlesschrome|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|aiohttp|httpx|curl\/|wget\/|go-http-client|java\/|okhttp|axios\/|node-fetch|undici|libwww|scrapy|\bbot\b|crawler|spider|scraper|fetcher|monitor|probe/i;

/** The in-app browsers that fans arrive through. Not bots. */
const IN_APP_UA = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bBytedance\b|\bTikTok\b|\bmusical_ly\b|\bSnapchat\b/i;

export function readVisitor(req: Request): Visitor {
  const h = req.headers;
  const ua = h.get("user-agent") ?? "";
  const ip =
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const salt = process.env.CRON_SECRET ?? "funnel";
  const hash = createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 32);
  const country = (h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? "").toUpperCase() || null;
  const referrer = h.get("referer")?.slice(0, 300) ?? null;
  const platform: Visitor["platform"] = /iPhone|iPad|iPod/i.test(ua)
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : "other";

  let bot: string | null = null;
  if (!ua) bot = "no user agent";
  else if (BOT_UA.test(ua) && !IN_APP_UA.test(ua)) bot = `ua: ${ua.match(BOT_UA)?.[0] ?? "crawler"}`;
  // Whatever it calls itself, a request from Meta's own network is Meta looking.
  else if (isMetaNetwork(ip)) bot = "Meta network";
  // A browser sends these; a script that only sets a user agent does not.
  else if (!h.get("accept-language")) bot = "no accept-language";
  else if (!(h.get("accept") ?? "").includes("text/html") && !h.get("sec-fetch-mode")) bot = "no browser accept";

  return { ua, hash, country, referrer, inApp: IN_APP_UA.test(ua), platform, bot };
}

/**
 * Three stamps, all signed with the server's secret and bound to the
 * visitor's network address and a window of time, so a value that was
 * logged somewhere and used later — by a crawler, from another network —
 * is refused. The user agent is left out on purpose: the fan leaves
 * Instagram's browser for Safari between getting a stamp and using it,
 * and the two do not call themselves the same thing.
 *
 *   key     the gate hands it out; it opens the real page   (10 min)
 *   pass    the real page sets it as a cookie; it keeps the
 *           real page open on a later visit                  (2 h)
 *   ticket  the card's address carries it; it takes the
 *           visitor through the redirect                     (15 min)
 */
const WINDOWS = { key: 10 * 60_000, pass: 2 * 3600_000, ticket: 15 * 60_000 } as const;

function ipKey(req: Request): string {
  const h = req.headers;
  const ip =
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return ip;
}

function stamp(purpose: keyof typeof WINDOWS, req: Request, window: number, scope = ""): string {
  const secret = process.env.CRON_SECRET ?? "funnel";
  return createHmac("sha256", secret)
    .update(`${purpose}|${scope}|${ipKey(req)}|${window}`)
    .digest("base64url")
    .slice(0, 24);
}

function issue(purpose: keyof typeof WINDOWS, req: Request, scope = ""): string {
  return stamp(purpose, req, Math.floor(Date.now() / WINDOWS[purpose]), scope);
}

/** This window and the one before, so a stamp lives one to two windows. */
function check(purpose: keyof typeof WINDOWS, req: Request, value: string | null, scope = ""): boolean {
  if (!value) return false;
  const now = Math.floor(Date.now() / WINDOWS[purpose]);
  for (const w of [now, now - 1]) {
    const want = stamp(purpose, req, w, scope);
    if (want.length === value.length && timingSafeEqual(Buffer.from(want), Buffer.from(value))) return true;
  }
  return false;
}

export const issueTicket = (req: Request) => issue("ticket", req);
export const checkTicket = (req: Request, t: string | null) => check("ticket", req, t);
export const issueKey = (req: Request) => issue("key", req);
export const checkKey = (req: Request, k: string | null) => check("key", req, k);
export const issuePass = (req: Request, pageId: string) => issue("pass", req, pageId);
export const checkPass = (req: Request, pageId: string, p: string | null) => check("pass", req, p, pageId);

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function findPage(host: string, slug: string | null) {
  const supabase = createAdminClient();
  const domain = host.toLowerCase().replace(/^www\./, "").split(":")[0];
  let q = supabase.from("funnel_pages").select("*").eq("domain", domain).eq("enabled", true);
  q = slug ? q.eq("slug", slug) : q.order("created_at", { ascending: true });
  const { data } = await q.limit(1).maybeSingle();
  return data;
}

export async function logEvent(
  page: FunnelPage,
  v: Visitor,
  kind: "view" | "click" | "canary" | "blocked",
  reason?: string | null
) {
  const supabase = createAdminClient();
  await supabase.from("funnel_events").insert({
    page_id: page.id,
    kind,
    bot: !!v.bot || kind === "canary",
    reason: reason ?? v.bot,
    country: v.country,
    visitor_hash: v.hash,
    referrer: v.referrer,
    in_app: v.inApp,
    platform: v.platform,
  });
}

/** Whoever followed the canary in the last day is a bot, whatever it says now. */
export async function tripped(page: FunnelPage, v: Visitor): Promise<boolean> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase
    .from("funnel_events")
    .select("id", { count: "exact", head: true })
    .eq("page_id", page.id)
    .eq("visitor_hash", v.hash)
    .eq("kind", "canary")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

export function blockedByCountry(page: FunnelPage, v: Visitor): boolean {
  return !!v.country && page.blocked_countries.map((c) => c.toUpperCase()).includes(v.country);
}

/** The page's numbers for the settings screen. */
export async function funnelStats(supabase: SupabaseClient<Database>, pageId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("funnel_events")
    .select("kind, bot, country, in_app, platform, reason, created_at")
    .eq("page_id", pageId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20_000);
  const rows = data ?? [];
  const humans = rows.filter((r) => !r.bot);
  const by = (f: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const r of humans) {
      const k = f(r) ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const views = humans.filter((r) => r.kind === "view").length;
  const clicks = humans.filter((r) => r.kind === "click").length;
  return {
    views,
    clicks,
    ctr: views > 0 ? clicks / views : null,
    bots: rows.filter((r) => r.bot).length,
    canary: rows.filter((r) => r.kind === "canary").length,
    blocked: rows.filter((r) => r.kind === "blocked" && !r.bot).length,
    inApp: humans.filter((r) => r.kind === "view" && r.in_app).length,
    byCountry: by((r) => r.country).slice(0, 8),
    byPlatform: by((r) => r.platform),
    botReasons: Array.from(
      rows
        .filter((r) => r.bot && r.reason)
        .reduce((m, r) => m.set(r.reason!, (m.get(r.reason!) ?? 0) + 1), new Map<string, number>())
        .entries()
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
    last: rows.slice(0, 20),
  };
}
