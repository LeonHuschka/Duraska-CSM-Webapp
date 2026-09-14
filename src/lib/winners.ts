import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { accountLabel } from "@/lib/account-analytics";
import { downloadVideo, resolveFacebookVideoUrl, resolveVideoUrl } from "@/lib/inspo-video";
import { deleteMessage, sendMessage, sendPhoto, sendVideo } from "@/lib/telegram";

/**
 * Winners: a reel on one of our accounts that took off.
 *
 * "Took off" is measured against the account itself — plays well above
 * what that account usually gets — with an absolute floor so a page with
 * thirty followers does not produce a winner out of three hundred plays.
 * Both numbers live in the Telegram settings.
 *
 * Runs after the daily scrape, which is where the plays come from. Each
 * reel is reported once, into the winners topic, with the reel itself as
 * a video so the model can watch what worked and shoot it again.
 */
const DAY = 86_400_000;
/** A reel older than this is history, not a new winner. */
const FRESH_DAYS = 30;

type Db = SupabaseClient<Database>;

export type WinnersSummary = { found: number; announced: number; notes: string[] };

export async function announceWinners(
  supabase: Db,
  personaId: string,
  opts: {
    /** Once, for the months before this existed: report old reels too. */
    includeOld?: boolean;
    /** Take back the winners on this platform and report them again — for the ones that went out without their video. */
    redoPlatform?: string;
  } = {}
): Promise<WinnersSummary> {
  const out: WinnersSummary = { found: 0, announced: 0, notes: [] };
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("chat_id, winners_thread_id, model_username, viral_lift, viral_min_views")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (!cfg?.chat_id || cfg.winners_thread_id == null) {
    out.notes.push("no winners topic configured");
    return out;
  }

  if (opts.redoPlatform) {
    const { data: redo } = await supabase
      .from("winners")
      .select("id, message_id, account_id, accounts!inner(platform)")
      .eq("persona_id", personaId)
      .eq("accounts.platform", opts.redoPlatform);
    for (const w of redo ?? []) {
      if (w.message_id != null) {
        await deleteMessage({ chat_id: cfg.chat_id, message_id: Number(w.message_id) });
      }
      await supabase.from("winners").delete().eq("id", w.id);
    }
    out.notes.push(`${redo?.length ?? 0} ${opts.redoPlatform} winners taken back`);
  }
  const lift = Number(cfg.viral_lift ?? 5);
  const minViews = Number(cfg.viral_min_views ?? 10_000);

  const [{ data: accounts }, { data: rows }, { data: known }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, handle, platform, posts_per_day")
      .eq("persona_id", personaId),
    supabase
      .from("reel_metrics")
      .select("account_id, shortcode, views, captured_at, posted_at, post_url, caption, request_id, tile_path")
      .eq("persona_id", personaId)
      .eq("source", "scrape")
      .eq("needs_review", false)
      .not("shortcode", "is", null)
      .not("views", "is", null)
      .order("captured_at", { ascending: false }),
    supabase.from("winners").select("shortcode").eq("persona_id", personaId),
  ]);
  const posting = new Map(
    (accounts ?? []).filter((a) => Number(a.posts_per_day ?? 0) > 0).map((a) => [a.id, a])
  );
  const seen = new Set((known ?? []).map((w) => w.shortcode));

  // Latest reading per reel, per account.
  type Reel = NonNullable<typeof rows>[number];
  const latest = new Map<string, Reel>();
  for (const r of rows ?? []) {
    if (!r.account_id || !posting.has(r.account_id)) continue;
    const key = `${r.account_id}|${r.shortcode}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const byAccount = new Map<string, Reel[]>();
  latest.forEach((r) => {
    const list = byAccount.get(r.account_id!) ?? [];
    list.push(r);
    byAccount.set(r.account_id!, list);
  });

  const freshSince = Date.now() - FRESH_DAYS * DAY;
  const candidates: { reel: Reel; median: number; lift: number }[] = [];
  byAccount.forEach((list) => {
    const views = list
      .map((r) => Number(r.views))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (views.length < 3) return; // nothing to compare against yet
    const median =
      views.length % 2 ? views[(views.length - 1) / 2] : (views[views.length / 2 - 1] + views[views.length / 2]) / 2;
    for (const r of list) {
      const v = Number(r.views);
      if (v < minViews || median <= 0 || v < lift * median) continue;
      if (seen.has(r.shortcode!)) continue;
      if (!opts.includeOld && r.posted_at && new Date(r.posted_at).getTime() < freshSince) continue;
      candidates.push({ reel: r, median, lift: v / median });
    }
  });
  out.found = candidates.length;
  candidates.sort((a, b) =>
    opts.includeOld
      ? (a.reel.posted_at ?? "").localeCompare(b.reel.posted_at ?? "")
      : Number(b.reel.views) - Number(a.reel.views)
  );

  // Titles for the reels the app knows.
  const requestIds = Array.from(
    new Set(candidates.map((c) => c.reel.request_id).filter((x): x is string => !!x))
  );
  const titles = new Map<string, string>();
  if (requestIds.length) {
    const { data: reqs } = await supabase.from("content_requests").select("id, title").in("id", requestIds);
    for (const q of reqs ?? []) titles.set(q.id, q.title);
  }

  for (const c of candidates) {
    const account = posting.get(c.reel.account_id!)!;
    const title =
      (c.reel.request_id && titles.get(c.reel.request_id)) ||
      (c.reel.caption ? `"${c.reel.caption.slice(0, 60)}${c.reel.caption.length > 60 ? "…" : ""}"` : "this reel");
    const text = message({
      account: `${accountLabel(account.handle)} (${platformName(account.platform)})`,
      title,
      views: Number(c.reel.views),
      lift: c.lift,
      url: c.reel.post_url,
      model: cfg.model_username,
      postedAt: opts.includeOld ? c.reel.posted_at : null,
    });

    // The reel itself: Instagram through the inspo-link resolver, Facebook
    // through its own. The cover when the video is out of reach, text alone
    // as the last resort — a winner must not go unreported over a download.
    let messageId: number | null = null;
    if (c.reel.post_url) {
      const resolved =
        account.platform === "facebook"
          ? await resolveFacebookVideoUrl(c.reel.post_url)
          : await resolveVideoUrl(c.reel.post_url);
      const bytes = resolved.ok ? await downloadVideo(resolved.url) : null;
      if (bytes) {
        const sent = await sendVideo({
          chat_id: cfg.chat_id,
          message_thread_id: cfg.winners_thread_id,
          video: bytes,
          filename: "winner.mp4",
          caption: text,
          parse_mode: "HTML",
        });
        if (sent.ok) messageId = sent.result?.message_id ?? null;
        else out.notes.push(`${c.reel.shortcode}: video not sent — ${sent.error}`);
      } else {
        out.notes.push(`${c.reel.shortcode}: video not fetched — ${resolved.ok ? "download failed" : resolved.note}`);
      }
    }
    if (messageId == null && c.reel.tile_path && /^https:\/\//.test(c.reel.tile_path)) {
      const cover = await downloadImage(c.reel.tile_path);
      if (cover) {
        const sent = await sendPhoto({
          chat_id: cfg.chat_id,
          message_thread_id: cfg.winners_thread_id,
          photo: cover,
          caption: text,
          parse_mode: "HTML",
        });
        if (sent.ok) messageId = sent.result?.message_id ?? null;
      }
    }
    if (messageId == null) {
      const sent = await sendMessage({
        chat_id: cfg.chat_id,
        message_thread_id: cfg.winners_thread_id,
        text,
      });
      if (!sent.ok) {
        out.notes.push(`${c.reel.shortcode}: not announced — ${sent.error}`);
        continue;
      }
      messageId = (sent.result as { message_id?: number } | undefined)?.message_id ?? null;
    }

    const { error } = await supabase.from("winners").insert({
      persona_id: personaId,
      account_id: c.reel.account_id,
      shortcode: c.reel.shortcode!,
      request_id: c.reel.request_id,
      post_url: c.reel.post_url,
      title,
      views: Number(c.reel.views),
      lift: Math.round(c.lift * 10) / 10,
      message_id: messageId,
    });
    if (error) out.notes.push(`${c.reel.shortcode}: not recorded — ${error.message}`);
    else out.announced++;
  }
  return out;
}

async function downloadImage(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res || !res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > 1_000 && bytes.byteLength < 10 * 1024 * 1024 ? bytes : null;
}

function platformName(p: string): string {
  return p === "instagram" ? "IG" : p === "facebook" ? "Facebook" : p;
}

function message(x: {
  account: string;
  title: string;
  views: number;
  lift: number;
  url: string | null;
  model: string | null;
  postedAt?: string | null;
}): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nf = new Intl.NumberFormat("de-DE");
  const at = x.model ? `@${x.model.replace(/^@/, "")}` : "";
  const when = x.postedAt
    ? ` · posted ${new Date(x.postedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`
    : "";
  const lines = [
    `🔥 <b>Winner on ${esc(x.account)}</b>`,
    `${esc(x.title)} · ${nf.format(x.views)} plays · ${x.lift.toFixed(0)}× the account's usual reach${when}`,
    ``,
    `${at ? `${at}, ` : ""}this one hit — please shoot a fresh version of it 💃🏻`,
  ];
  if (x.url) lines.push(`🔗 Link: ${esc(x.url)}`);
  return lines.join("\n");
}
