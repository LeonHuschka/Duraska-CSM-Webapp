import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { accountLabel } from "@/lib/account-analytics";
import { sendMessage } from "@/lib/telegram";
import { APP_URL } from "@/lib/trials";

/**
 * Posting focus: every morning, after the scrape, each account's topic
 * hears which of its recent reels did best and what to post because of
 * it — more cuts of those reels while the vault has any, reels like them
 * once it has none.
 *
 * "Did best" is the account board's measure: plays against the account's
 * own median, 2× and up, so the topic names the reels the board shows
 * with a green or amber badge.
 */
const DAY = 86_400_000;
/** Only what went up lately says what works now. */
const WINDOW_DAYS = 14;
/** Below this the board shows no badge either. */
const MIN_LIFT = 2;
const MAX_REELS = 3;
/** An account with fewer reels has no usual reach to beat yet. */
const MIN_REELS = 5;

type Db = SupabaseClient<Database>;

export async function sendPostingFocus(
  supabase: Db,
  personaId: string,
  opts: { dryRun?: boolean } = {}
): Promise<string[]> {
  const notes: string[] = [];
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, handle, platform, telegram_chat_id, telegram_thread_id, manager_username, posts_per_day")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")')
    .gt("posts_per_day", 0)
    .not("telegram_chat_id", "is", null);
  if (!accounts?.length) return ["no account topics"];

  const { data: rows } = await supabase
    .from("reel_metrics")
    .select("account_id, shortcode, views, captured_at, posted_at, post_url, request_id")
    .eq("persona_id", personaId)
    .eq("source", "scrape")
    .eq("needs_review", false)
    .in(
      "account_id",
      accounts.map((a) => a.id)
    )
    .not("shortcode", "is", null)
    .order("captured_at", { ascending: false });
  type Reel = NonNullable<typeof rows>[number];
  // Newest reading per reel.
  const latest = new Map<string, Reel>();
  for (const r of rows ?? []) {
    const key = `${r.account_id}|${r.shortcode}`;
    if (!latest.has(key)) latest.set(key, r);
  }

  const since = Date.now() - WINDOW_DAYS * DAY;
  for (const a of accounts) {
    const reels = Array.from(latest.values()).filter((r) => r.account_id === a.id);
    const views = reels
      .map((r) => Number(r.views ?? 0))
      .filter((v) => v > 0)
      .sort((x, y) => x - y);
    if (views.length < MIN_REELS) {
      notes.push(`${a.handle}: too few reels`);
      continue;
    }
    const median =
      views.length % 2 ? views[(views.length - 1) / 2] : (views[views.length / 2 - 1] + views[views.length / 2]) / 2;
    const top = reels
      .filter((r) => r.posted_at && new Date(r.posted_at).getTime() >= since)
      .map((r) => ({ reel: r, lift: Number(r.views ?? 0) / median }))
      .filter((x) => x.lift >= MIN_LIFT)
      .sort((x, y) => y.lift - x.lift)
      .slice(0, MAX_REELS);
    if (top.length === 0) {
      notes.push(`${a.handle}: nothing above ${MIN_LIFT}×`);
      continue;
    }

    const lines = await Promise.all(top.map((t) => reelLine(supabase, t.reel, t.lift)));
    const nf = new Intl.NumberFormat("de-DE");
    const va = a.manager_username ? `@${a.manager_username.replace(/^@/, "")}, ` : "";
    const text = [
      `🎯 <b>Posting focus for ${esc(accountLabel(a.handle))}</b>`,
      `${va}${top.length === 1 ? "this reel" : `these ${top.length} reels`} did best in the last ${WINDOW_DAYS} days (usual: ${nf.format(Math.round(median))} plays):`,
      ``,
      ...lines,
      ``,
      `👉 Post the remaining cuts of ${top.length === 1 ? "it" : "these"} first. When one has no cuts left, pick reels in the vault that look like it — same outfit, hook or vibe.`,
    ].join("\n");
    if (opts.dryRun) {
      notes.push(`${a.handle}:\n${text}`);
      continue;
    }
    const res = await sendMessage({
      chat_id: a.telegram_chat_id!,
      message_thread_id: a.telegram_thread_id,
      text,
      buttons: [{ text: "Open the vault", url: `${APP_URL}/vault` }],
    });
    notes.push(`${a.handle}: ${res.ok ? `sent (${top.length})` : `not sent — ${res.error}`}`);
  }
  return notes;
}

/** One reel: its name, how far it got, and what the vault still holds of it. */
async function reelLine(
  supabase: Db,
  r: { request_id: string | null; views: number | null; post_url: string | null },
  lift: number
): Promise<string> {
  const nf = new Intl.NumberFormat("de-DE");
  const icon = lift >= 5 ? "🔥" : "📈";
  const stats = `${nf.format(Number(r.views ?? 0))} plays · ${lift.toFixed(1)}×`;
  if (!r.request_id) {
    const link = r.post_url ? `<a href="${esc(r.post_url)}">this reel</a>` : "a reel the app does not know";
    return `${icon} ${link} · ${stats}\n    → no cuts of it in the app, post reels like it`;
  }
  const [{ data: req }, { data: cuts }] = await Promise.all([
    supabase.from("content_requests").select("title, is_nsfw").eq("id", r.request_id).maybeSingle(),
    supabase
      .from("content_assets")
      .select("id")
      .eq("request_id", r.request_id)
      .eq("stage", "edited")
      .is("deleted_at", null),
  ]);
  // A cut goes out once, anywhere — the vault's "free".
  const ids = (cuts ?? []).map((c) => c.id);
  const { data: posted } = ids.length
    ? await supabase.from("schedule_slots").select("asset_id").in("asset_id", ids).eq("status", "posted")
    : { data: [] as { asset_id: string | null }[] };
  const taken = new Set((posted ?? []).map((p) => p.asset_id));
  const free = req?.is_nsfw ? 0 : ids.filter((id) => !taken.has(id)).length;
  const name = `<b>${esc(req?.title ?? "Reel")}</b>`;
  return `${icon} ${name} · ${stats}\n    → ${
    free > 0 ? `${free} more ${free === 1 ? "cut" : "cuts"} in the vault — post ${free === 1 ? "it" : "them"}` : "no cuts left — post reels like it"
  }`;
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
