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
/**
 * Reels younger than this are still collecting plays and stay out of the
 * usual reach, as for winners — a morning of fresh posts would halve it.
 */
const SETTLED_DAYS = 3;

type Db = SupabaseClient<Database>;

export async function sendPostingFocus(
  supabase: Db,
  personaId: string,
  opts: { dryRun?: boolean } = {}
): Promise<string[]> {
  const notes: string[] = [];
  // Its own topic only: an account with no topic set would land in the
  // group's general chat.
  let q = supabase
    .from("accounts")
    .select("id, handle, platform, telegram_chat_id, telegram_thread_id, manager_username, posts_per_day")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")')
    .gt("posts_per_day", 0);
  if (!opts.dryRun) q = q.not("telegram_chat_id", "is", null).not("telegram_thread_id", "is", null);
  const { data: accounts } = await q;
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
    const settledBefore = Date.now() - SETTLED_DAYS * DAY;
    const settled = reels.filter((r) => !r.posted_at || new Date(r.posted_at).getTime() < settledBefore);
    // A young account has few settled reels yet; then all of them count.
    const views = (settled.length >= MIN_REELS ? settled : reels)
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

    const lines = await Promise.all(top.map((t) => reelLine(supabase, a.id, t.reel, t.lift)));
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
      notes.push(`${a.handle}${a.telegram_thread_id == null ? " (no topic set — would not be sent)" : ""}:\n${text}`);
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

/**
 * One reel: its name, how far it got, and what the vault still holds of
 * it. A Trial-Maxxing outlier is one reel of many: its reshoots for this
 * account are the cuts to post.
 */
async function reelLine(
  supabase: Db,
  accountId: string,
  r: { request_id: string | null; shortcode: string | null; views: number | null; post_url: string | null },
  lift: number
): Promise<string> {
  const nf = new Intl.NumberFormat("de-DE");
  const icon = lift >= 5 ? "🔥" : "📈";
  const stats = `${nf.format(Number(r.views ?? 0))} plays · ${lift.toFixed(1)}×`;

  const requestIds = r.request_id ? [r.request_id] : [];
  const { data: trial } = r.shortcode
    ? await supabase.from("trials").select("id").eq("account_id", accountId).eq("shortcode", r.shortcode).maybeSingle()
    : { data: null };
  if (trial) {
    const { data: cells } = await supabase
      .from("trial_cells")
      .select("request_id")
      .eq("trial_id", trial.id)
      .not("request_id", "is", null);
    for (const c of cells ?? []) if (c.request_id) requestIds.push(c.request_id);
  }

  let title: string | null = null;
  let free = 0;
  if (requestIds.length) {
    const [{ data: reqs }, { data: cuts }] = await Promise.all([
      supabase.from("content_requests").select("id, title, is_nsfw").in("id", requestIds),
      supabase
        .from("content_assets")
        .select("id, request_id")
        .in("request_id", requestIds)
        .eq("stage", "edited")
        .is("deleted_at", null),
    ]);
    title = r.request_id ? reqs?.find((q) => q.id === r.request_id)?.title ?? null : null;
    const nsfw = new Set((reqs ?? []).filter((q) => q.is_nsfw).map((q) => q.id));
    // A cut goes out once, anywhere — the vault's "free".
    const ids = (cuts ?? []).filter((c) => !nsfw.has(c.request_id)).map((c) => c.id);
    const { data: posted } = ids.length
      ? await supabase.from("schedule_slots").select("asset_id").in("asset_id", ids).eq("status", "posted")
      : { data: [] as { asset_id: string | null }[] };
    const taken = new Set((posted ?? []).map((p) => p.asset_id));
    free = ids.filter((id) => !taken.has(id)).length;
  }

  const name = title
    ? `<b>${esc(title)}</b>`
    : r.post_url
      ? `<a href="${esc(r.post_url)}">${trial ? "the Trial-Maxxing reel" : "this reel"}</a>`
      : "a reel";
  const todo =
    free > 0
      ? `${free} more ${free === 1 ? "cut" : "cuts"} in the vault${trial ? " (Trial-Maxxing reshoots)" : ""} — post ${free === 1 ? "it" : "them"}`
      : "no cuts left — post reels like it";
  return `${icon} ${name} · ${stats}\n    → ${todo}`;
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
