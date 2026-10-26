import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { apifyRunSync } from "@/lib/apify";
import { berlinDay } from "@/lib/berlin-day";
import { downloadVideo, resolveFacebookVideoUrl, resolveVideoUrl } from "@/lib/inspo-video";
import { sendMessage, sendPhoto, sendVideo } from "@/lib/telegram";

/**
 * The weekly pattern analysis: not which reels did well — the tiles show
 * that — but why. Once a week, per account, every reel of the past seven
 * days goes to Claude with its cover, its numbers against the account's own
 * middle, when it went up, its caption, what it was made from (the inspo
 * link and its note, the Trial-Maxxing cell it is), and on Facebook what
 * people wrote under it. What comes back is a reading of the week, the
 * standouts with the reason they stood out, what fell flat, the patterns,
 * and targets to shoot next week. It is posted into the PATTERN ANALYSIS
 * topic with the standouts' videos, and kept in pattern_reports.
 *
 * Instagram comments are not read: these reels carry nought to three, and
 * no actor returns them to a logged-out reader. Their count goes in.
 */

type Db = SupabaseClient<Database>;
const DAY = 86_400_000;
const MODEL = "claude-opus-5-5";
/** Facebook comments, $0.00025 each, for the reels that stood out. */
const FB_COMMENTS_ACTOR = "dami_studio~facebook-comments-scraper";
const COMMENTED_REELS = 3;
const COMMENTS_PER_REEL = 25;
/** Telegram captions stop at 1024 characters. */
const CAPTION_MAX = 1000;

const Analysis = z.object({
  headline: z.string().describe("One sentence: what this week on this account comes down to."),
  week_read: z
    .string()
    .describe("Three to five sentences on the week: what carried it, what did not, against the account's own middle."),
  standouts: z
    .array(
      z.object({
        reel: z.string().describe("The reel's label, e.g. R3."),
        reel_type: z.string().describe("What kind of reel it is, in a few words (format, setting, on-screen device)."),
        hook: z.string().describe("The hook: what the first second shows or says, as far as the cover and caption tell."),
        why: z
          .string()
          .describe("Why this one beat the others on this account, from the evidence — two to four sentences."),
        comment_themes: z
          .array(z.string())
          .describe("What the comments talk about, if comments were given; empty otherwise."),
      })
    )
    .describe("The reels that clearly beat the account's middle this week, best first. At most three."),
  flops: z
    .array(z.object({ reel: z.string(), why: z.string().describe("One or two sentences.") }))
    .describe("Reels that fell clearly short, with the likely reason. At most three."),
  patterns: z
    .array(z.string())
    .describe("Patterns across this account's reels — what the good ones share and the weak ones lack. Three to six."),
  targets: z
    .array(
      z.object({
        target: z.string().describe("What to shoot or change next week, in one line."),
        how: z.string().describe("How, concretely enough to shoot from: outfit, place, hook, length, caption."),
      })
    )
    .describe("Three to five targets for next week on this account, most important first."),
  caveat: z
    .string()
    .describe("What limits this reading — few reels, young reels, missing data. One sentence, or empty."),
});
export type PatternAnalysis = z.infer<typeof Analysis>;

const SYSTEM = `You analyse short-form video performance for a creator-management studio. One creator persona ("Sarah Price") runs several Instagram and Facebook accounts; virtual assistants post the reels, and every reel's real goal is reach, because reach turns into followers and then link clicks.

Each week you get one account's reels from the past seven days, each with its cover image, its plays against the account's own median, when it was posted, its caption, what it was made from — the inspiration reel it copies and the note written beside that link, or the Trial-Maxxing cell it is (a reshoot of an earlier outlier that varies one thing: outfit, location or hook) — and, on Facebook, the comments under the best ones.

Explain why the outliers outperformed the rest of this account, not reels in general. Work from the evidence you are given: the cover shows the setting, outfit, framing and any on-screen text of the first frame; the caption and the inspiration note show the idea. Say what is evidence and what is a likely explanation. Compare within the account: a reel at 5x the median says more than raw plays, and a reel posted a day ago has had less time than one posted a week ago — weigh age when you compare.

Targets for next week must be concrete enough that the creator can shoot from them without asking back.

Write in plain English, short sentences, no hype.`;

type ReelIn = {
  label: string;
  shortcode: string;
  url: string | null;
  postedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  caption: string | null;
  cover: string | null;
  lift: number | null;
  requestId: string | null;
  job: string | null;
  inspo: { url: string; note: string | null } | null;
  trial: string | null;
  commentTexts: string[];
};

type AccountIn = {
  id: string;
  personaId: string;
  label: string;
  handle: string;
  platform: string;
};

/** The seven Berlin days that end with `end` (inclusive), as keys. */
export function weekBefore(end: string): { from: string; to: string } {
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return { from: new Date(endTime - 6 * DAY).toISOString().slice(0, 10), to: end };
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const nf = new Intl.NumberFormat("en-US");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Everything the analysis needs about one account's week. */
async function gather(supabase: Db, account: AccountIn, from: string, to: string) {
  const baselineFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 28 * DAY).toISOString();
  const { data: rows } = await supabase
    .from("reel_metrics")
    .select("shortcode, post_url, posted_at, captured_at, views, likes, comments, shares, caption, cover_path, tile_path, request_id")
    .eq("account_id", account.id)
    .eq("source", "scrape")
    .gte("posted_at", baselineFrom)
    .order("captured_at", { ascending: false })
    .limit(5000);
  const latest = new Map<string, NonNullable<typeof rows>[number]>();
  for (const r of rows ?? []) if (r.shortcode && !latest.has(r.shortcode)) latest.set(r.shortcode, r);
  const all = Array.from(latest.values()).filter((r) => r.posted_at);
  const mid = median(all.map((r) => r.views ?? 0).filter((v) => v > 0));
  const week = all
    .filter((r) => {
      const k = berlinDay(r.posted_at!);
      return k >= from && k <= to;
    })
    .sort((a, b) => (a.posted_at! < b.posted_at! ? -1 : 1));

  // What each of our reels was made from.
  const requestIds = Array.from(new Set(week.map((r) => r.request_id).filter((x): x is string => !!x)));
  const [{ data: requests }, { data: links }, { data: cells }] = requestIds.length
    ? await Promise.all([
        supabase.from("content_requests").select("id, title, description").in("id", requestIds),
        supabase.from("content_links").select("request_id, url, note").in("request_id", requestIds),
        supabase.from("trial_cells").select("request_id, dimension, slot, label, trial_id").in("request_id", requestIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const trialIds = Array.from(new Set((cells ?? []).map((c) => c.trial_id)));
  const { data: trials } = trialIds.length
    ? await supabase.from("trials").select("id, shortcode, views").in("id", trialIds)
    : { data: [] as { id: string; shortcode: string; views: number | null }[] };

  // Covers from our own storage, signed for the hour the analysis takes.
  const coverPaths = week.map((r) => r.cover_path).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (coverPaths.length) {
    const { data: urls } = await supabase.storage.from("content-assets").createSignedUrls(coverPaths, 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const reels: ReelIn[] = week.map((r, i) => {
    const req = (requests ?? []).find((q) => q.id === r.request_id);
    const link = (links ?? []).find((l) => l.request_id === r.request_id);
    const cell = (cells ?? []).find((c) => c.request_id === r.request_id);
    const trial = cell ? (trials ?? []).find((t) => t.id === cell.trial_id) : undefined;
    return {
      label: `R${i + 1}`,
      shortcode: r.shortcode!,
      url: r.post_url,
      postedAt: r.posted_at!,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      caption: r.caption,
      cover: (r.cover_path && signed.get(r.cover_path)) || r.tile_path || null,
      lift: r.views != null && mid > 0 ? r.views / mid : null,
      requestId: r.request_id,
      job: req ? `${req.title}${req.description ? ` — ${req.description}` : ""}` : null,
      inspo: link ? { url: link.url, note: link.note } : null,
      trial: cell
        ? `Trial-Maxxing reshoot of ${trial?.shortcode ?? "an earlier outlier"}${
            trial?.views ? ` (${nf.format(trial.views)} plays)` : ""
          }: ${cell.dimension} variant ${cell.slot}${cell.label ? ` "${cell.label}"` : ""}`
        : null,
      commentTexts: [],
    };
  });

  // On Facebook, what people wrote under the best ones.
  if (account.platform === "facebook") {
    const top = [...reels].sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, COMMENTED_REELS);
    const urls = top.map((r) => r.url).filter((u): u is string => !!u);
    if (urls.length) {
      const res = await apifyRunSync(
        FB_COMMENTS_ACTOR,
        { startUrls: urls.map((url) => ({ url })), resultsLimit: COMMENTS_PER_REEL },
        { query: { memory: 512 }, signal: AbortSignal.timeout(120_000) }
      ).catch(() => null);
      const items = res?.ok ? ((await res.json().catch(() => [])) as Record<string, unknown>[]) : [];
      for (const c of Array.isArray(items) ? items : []) {
        const text = typeof c.text === "string" ? c.text.trim() : "";
        const input = typeof c.inputUrl === "string" ? c.inputUrl : "";
        const reel = top.find((r) => r.url && (input === r.url || input.includes(r.url.replace(/\/$/, ""))));
        if (reel && text) reel.commentTexts.push(text.slice(0, 200));
      }
    }
  }

  return { reels, median: mid, baselineCount: all.length };
}

/** The request to Claude: one text block per reel after its cover. */
function buildContent(account: AccountIn, from: string, to: string, data: Awaited<ReturnType<typeof gather>>) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text:
        `Account: ${account.label} (${account.platform}, ${account.handle}).\n` +
        `Week: ${from} to ${to} (Berlin). ${data.reels.length} reels posted.\n` +
        `Median plays of this account's reels over the last five weeks: ${nf.format(Math.round(data.median))} (${data.baselineCount} reels).\n` +
        `Plays as read this morning. Below, each reel's cover image followed by its data.`,
    },
  ];
  const now = Date.now();
  for (const r of data.reels) {
    if (r.cover) content.push({ type: "image", source: { type: "url", url: r.cover } });
    const age = ((now - new Date(r.postedAt).getTime()) / DAY).toFixed(1);
    const lines = [
      `${r.label} — posted ${when(r.postedAt)} (${age} days ago)`,
      `plays ${r.views == null ? "unknown" : nf.format(r.views)}${r.lift != null ? ` = ${r.lift.toFixed(1)}x median` : ""} · likes ${r.likes ?? "?"} · comments ${r.comments ?? "?"}${r.shares != null ? ` · shares ${r.shares}` : ""}`,
      r.caption ? `caption: ${r.caption.slice(0, 400)}` : "caption: (none)",
      r.job ? `our job: ${r.job.slice(0, 300)}` : null,
      r.inspo ? `made from inspiration ${r.inspo.url}${r.inspo.note ? ` — note: ${r.inspo.note.slice(0, 300)}` : ""}` : null,
      r.trial,
      r.commentTexts.length ? `comments:\n- ${r.commentTexts.join("\n- ")}` : null,
      r.cover ? null : "(no cover image)",
    ].filter(Boolean);
    content.push({ type: "text", text: lines.join("\n") });
  }
  content.push({
    type: "text",
    text: "Analyse this account's week as instructed. Refer to reels by their label (R1, R2, …).",
  });
  return content;
}

async function analyse(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<PatternAnalysis> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(Analysis) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`refused${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`);
  }
  if (!response.parsed_output) throw new Error(`no analysis in the answer (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

/** The standout's video: our own cut if we have it, else the platform's file. */
async function standoutVideo(supabase: Db, reel: ReelIn, platform: string): Promise<Uint8Array | null> {
  if (reel.requestId) {
    const { data: cut } = await supabase
      .from("content_assets")
      .select("file_path")
      .eq("request_id", reel.requestId)
      .eq("stage", "edited")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cut?.file_path) {
      const { data: blob } = await supabase.storage.from("content-assets").download(cut.file_path);
      if (blob) return new Uint8Array(await blob.arrayBuffer());
    }
  }
  if (!reel.url) return null;
  const resolved = platform === "facebook" ? await resolveFacebookVideoUrl(reel.url) : await resolveVideoUrl(reel.url);
  return resolved.ok ? downloadVideo(resolved.url) : null;
}

/** Post one account's analysis: the reading, each standout with its video, then patterns and targets. */
async function post(
  supabase: Db,
  chatId: number,
  threadId: number,
  account: AccountIn,
  from: string,
  to: string,
  data: Awaited<ReturnType<typeof gather>>,
  a: PatternAnalysis
) {
  const byLabel = new Map(data.reels.map((r) => [r.label, r]));
  const best = [...data.reels].sort((x, y) => (y.lift ?? 0) - (x.lift ?? 0))[0];
  const range = `${from.slice(8, 10)}.${from.slice(5, 7)}. – ${to.slice(8, 10)}.${to.slice(5, 7)}.`;
  await sendMessage({
    chat_id: chatId,
    message_thread_id: threadId,
    text:
      `📊 <b>${esc(account.label)}</b> · ${account.platform === "facebook" ? "Facebook" : "Instagram"} · ${range}\n\n` +
      `<b>${esc(a.headline)}</b>\n\n${esc(a.week_read)}\n\n` +
      `<i>${data.reels.length} reels · median ${nf.format(Math.round(data.median))} plays` +
      (best?.lift ? ` · best ${best.lift.toFixed(1)}×` : "") +
      `</i>`,
  });

  for (const s of a.standouts.slice(0, 3)) {
    const reel = byLabel.get(s.reel);
    if (!reel) continue;
    const head =
      `🔥 <b>${esc(s.reel_type)}</b>\n` +
      `${reel.views != null ? nf.format(reel.views) : "?"} plays${reel.lift ? ` · ${reel.lift.toFixed(1)}× median` : ""} · ${when(reel.postedAt)}\n\n`;
    const body =
      `<b>Hook:</b> ${esc(s.hook)}\n<b>Why:</b> ${esc(s.why)}` +
      (s.comment_themes.length ? `\n<b>Comments:</b> ${esc(s.comment_themes.join(" · "))}` : "");
    const caption = (head + body).length <= CAPTION_MAX ? head + body : head.trimEnd();
    const buttons = reel.url ? [{ text: "Open the reel", url: reel.url }] : undefined;
    const video = await standoutVideo(supabase, reel, account.platform).catch(() => null);
    let sent = video
      ? await sendVideo({ chat_id: chatId, message_thread_id: threadId, video, caption, parse_mode: "HTML", buttons })
      : { ok: false };
    if (!sent.ok && reel.cover) {
      const res = await fetch(reel.cover).catch(() => null);
      const photo = res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (photo) sent = await sendPhoto({ chat_id: chatId, message_thread_id: threadId, photo, caption, parse_mode: "HTML", buttons });
    }
    if (!sent.ok || caption !== head + body) {
      await sendMessage({ chat_id: chatId, message_thread_id: threadId, text: sent.ok ? body : head + body });
    }
  }

  const flops = a.flops
    .map((f) => {
      const r = byLabel.get(f.reel);
      return `• ${r?.views != null ? `${nf.format(r.views)} plays — ` : ""}${esc(f.why)}`;
    })
    .join("\n");
  await sendMessage({
    chat_id: chatId,
    message_thread_id: threadId,
    text:
      `🧠 <b>Patterns · ${esc(account.label)}</b>\n${a.patterns.map((p) => `• ${esc(p)}`).join("\n")}` +
      (flops ? `\n\n📉 <b>What fell flat</b>\n${flops}` : "") +
      `\n\n🎯 <b>Targets for next week</b>\n${a.targets
        .map((t, i) => `${i + 1}. <b>${esc(t.target)}</b>\n   ${esc(t.how)}`)
        .join("\n")}` +
      (a.caveat ? `\n\n<i>${esc(a.caveat)}</i>` : ""),
  });
}

export type PatternResult = { account: string; ok: boolean; note: string; reels?: number };

/**
 * One account's week, analysed, stored and — when the persona has a
 * PATTERN ANALYSIS topic and `send` is on — posted.
 */
export async function runPatternAnalysis(
  supabase: Db,
  accountId: string,
  opts: { end: string; send: boolean }
): Promise<PatternResult> {
  const { data: acc } = await supabase
    .from("accounts")
    .select("id, persona_id, handle, display_name, platform")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return { account: accountId, ok: false, note: "no such account" };
  const handle = acc.handle.replace(/^@/, "");
  const account: AccountIn = {
    id: acc.id,
    personaId: acc.persona_id,
    handle,
    platform: acc.platform,
    label: acc.display_name || (/^https?:\/\//.test(handle) ? "Facebook page" : `@${handle}`),
  };
  const { from, to } = weekBefore(opts.end);
  const data = await gather(supabase, account, from, to);
  if (data.reels.length === 0) return { account: account.label, ok: true, note: "no reels this week", reels: 0 };

  const analysis = await analyse(buildContent(account, from, to, data));
  await supabase.from("pattern_reports").upsert(
    { persona_id: account.personaId, account_id: account.id, week_start: from, analysis, model: MODEL },
    { onConflict: "account_id,week_start" }
  );

  if (!opts.send) return { account: account.label, ok: true, note: "analysed, not sent", reels: data.reels.length };
  const { data: cfg } = await supabase
    .from("telegram_config")
    .select("chat_id, pattern_thread_id")
    .eq("persona_id", account.personaId)
    .maybeSingle();
  if (!cfg?.chat_id || !cfg.pattern_thread_id) {
    return { account: account.label, ok: false, note: "no PATTERN ANALYSIS topic yet — write anything in it once", reels: data.reels.length };
  }
  await post(supabase, cfg.chat_id, cfg.pattern_thread_id, account, from, to, data, analysis);
  await supabase
    .from("pattern_reports")
    .update({ sent_at: new Date().toISOString() })
    .eq("account_id", account.id)
    .eq("week_start", from);
  return { account: account.label, ok: true, note: "sent", reels: data.reels.length };
}

/** The accounts a weekly run covers: active, posting, persona by persona. */
export async function patternAccounts(supabase: Db, personaId?: string): Promise<string[]> {
  let q = supabase.from("accounts").select("id").not("status", "in", '("dead","paused")').gt("posts_per_day", 0);
  if (personaId) q = q.eq("persona_id", personaId);
  const { data } = await q;
  return (data ?? []).map((a) => a.id);
}
