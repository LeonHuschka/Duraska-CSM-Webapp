import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { apifyRunSync } from "@/lib/apify";
import { downloadVideo, resolveFacebookVideoUrl, resolveVideoUrl } from "@/lib/inspo-video";
import { GEMINI_MODEL, watchVideo } from "@/lib/gemini";
import { CODEBOOK_VERSION, REEL_SCHEMA, type CommentRead, type ReelFeatures } from "@/lib/analysis/codebook";

type Db = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["reel_analyses"]["Row"];

/**
 * One reel, watched once: the video to Gemini against the codebook, and for
 * winners the comments to Claude. Gemini is not told how the reel did — it
 * describes, it does not explain, so knowing the outcome could only colour
 * what it sees.
 */
const SYSTEM = `You classify short vertical videos (Instagram/Facebook reels) of a female content creator for a statistical study.

Describe only what is actually visible or audible. Never guess: when something cannot be told, answer "unclear" (or null for free text and numbers). Do not judge quality or predict performance — you are describing, not explaining.

Use the fixed values of the schema. For clothing items and accessories use short lower-case English nouns and the most common name for the thing (e.g. "hairband", not "hair accessory band"). Keep free text short and factual. Times are seconds from the start of the video.`;

const IG_COMMENTS_ACTOR = "apify~instagram-comment-scraper";
const FB_COMMENTS_ACTOR = "dami_studio~facebook-comments-scraper";
const COMMENTS_PER_REEL = 30;
const CLAUDE = "claude-opus-5-5";

/** The video as posted: our own cut when the app has it, else the platform's file. */
async function videoOf(supabase: Db, row: Row, platform: string): Promise<{ bytes: Uint8Array; mime: string } | string> {
  if (row.request_id) {
    const { data: cut } = await supabase
      .from("content_assets")
      .select("file_path")
      .eq("request_id", row.request_id)
      .eq("stage", "edited")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cut?.file_path) {
      const { data: blob } = await supabase.storage.from("content-assets").download(cut.file_path);
      if (blob) {
        const mime = /\.mov$/i.test(cut.file_path) ? "video/quicktime" : /\.webm$/i.test(cut.file_path) ? "video/webm" : "video/mp4";
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
      }
    }
  }
  if (!row.post_url) return "no post url";
  const resolved = platform === "facebook" ? await resolveFacebookVideoUrl(row.post_url) : await resolveVideoUrl(row.post_url);
  if (!resolved.ok) return resolved.note;
  const bytes = await downloadVideo(resolved.url);
  return bytes ? { bytes, mime: "video/mp4" } : "video download failed";
}

async function commentsOf(row: Row, platform: string): Promise<string[]> {
  if (!row.post_url) return [];
  const res = await apifyRunSync(
    platform === "facebook" ? FB_COMMENTS_ACTOR : IG_COMMENTS_ACTOR,
    platform === "facebook"
      ? { startUrls: [{ url: row.post_url }], resultsLimit: COMMENTS_PER_REEL }
      : { directUrls: [row.post_url], resultsLimit: COMMENTS_PER_REEL },
    { query: { memory: 512 }, signal: AbortSignal.timeout(120_000) }
  ).catch(() => null);
  const items = res?.ok ? ((await res.json().catch(() => [])) as Record<string, unknown>[]) : [];
  return (Array.isArray(items) ? items : [])
    .map((c) => (typeof c.text === "string" ? c.text.trim().slice(0, 300) : ""))
    .filter(Boolean)
    .slice(0, COMMENTS_PER_REEL);
}

const CommentSchema = z.object({
  themes: z.array(z.string()).describe("Recurring topics, 1–3 lower-case words each, e.g. 'outfit', 'eyes', 'location'."),
  questions: z.array(z.string()).describe("Questions viewers ask, shortened."),
  compliments: z.array(z.string()).describe("Recurring compliments, shortened."),
  reacting_to: z
    .array(z.string())
    .describe("What in the video viewers react to, 1–3 lower-case words each, e.g. 'hairband', 'the turn', 'smile'."),
  emotions: z.array(z.string()).describe("Emotions shown, one lower-case word each, e.g. 'admiration', 'humor', 'desire'."),
  shareable_moments: z.array(z.string()).describe("Moments that comments point to as memorable or worth sharing."),
});

async function readComments(comments: string[], summary: string): Promise<CommentRead> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: CLAUDE,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(CommentSchema) },
    system:
      "You read the comments under one short video of a content creator and sort what viewers say. Only report what the comments actually show; keep every entry short and use the same lower-case words for the same thing. Empty lists are fine.",
    messages: [
      {
        role: "user",
        content: `The video: ${summary}\n\nComments:\n- ${comments.join("\n- ")}`,
      },
    ],
  });
  if (!response.parsed_output) throw new Error(`no comment reading (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

/** Watch one claimed row and store the result. Never throws: failures are written to the row. */
export async function watchReel(supabase: Db, row: Row): Promise<{ ok: boolean; note: string; usd: number }> {
  const { data: acc } = await supabase.from("accounts").select("platform").eq("id", row.account_id).maybeSingle();
  const platform = acc?.platform ?? "instagram";
  const { data: metric } = await supabase
    .from("reel_metrics")
    .select("caption")
    .eq("account_id", row.account_id)
    .eq("shortcode", row.shortcode)
    .not("caption", "is", null)
    .limit(1)
    .maybeSingle();
  let usd = 0;
  const fail = async (note: string) => {
    await supabase.from("reel_analyses").update({ status: "failed", note }).eq("id", row.id);
    return { ok: false, note, usd };
  };

  try {
    let features = row.features as unknown as ReelFeatures | null;
    const fresh = !features || (row.codebook_version ?? 0) < CODEBOOK_VERSION;
    if (fresh) {
      const video = await videoOf(supabase, row, platform);
      if (typeof video === "string") return fail(video);
      const res = await watchVideo<ReelFeatures>({
        video: video.bytes,
        mime: video.mime,
        system: SYSTEM,
        prompt: `Platform: ${platform}. Caption: ${metric?.caption ? metric.caption.slice(0, 600) : "(none)"}\n\nClassify this reel against the schema.`,
        schema: REEL_SCHEMA,
      });
      usd += res.usage?.usd ?? 0;
      if (!res.ok) return fail(res.note);
      features = res.value;
      await supabase
        .from("reel_analyses")
        .update({
          features: features as unknown as Json,
          model: GEMINI_MODEL,
          usage: res.usage as unknown as Json,
          codebook_version: CODEBOOK_VERSION,
          analysed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    // Winners also get what people wrote under them.
    if (row.cohort === "winner" && row.comment_texts == null) {
      const texts = await commentsOf(row, platform);
      usd += texts.length * (platform === "facebook" ? 0.00025 : 0.0026);
      const read = texts.length >= 3 ? await readComments(texts, features!.summary) : null;
      await supabase
        .from("reel_analyses")
        .update({ comment_texts: texts as unknown as Json, comment_read: read as unknown as Json })
        .eq("id", row.id);
    }

    await supabase.from("reel_analyses").update({ status: "done", note: null }).eq("id", row.id);
    return { ok: true, note: fresh ? "watched" : "comments read", usd };
  } catch (err) {
    return fail(err instanceof Error ? err.message.slice(0, 200) : "failed");
  }
}

/** Rows to work on next: new, failed fewer than three times, or winners still without comments. */
export async function claimRows(supabase: Db, personaId: string, limit: number): Promise<Row[]> {
  const { data: open } = await supabase
    .from("reel_analyses")
    .select("*")
    .eq("persona_id", personaId)
    .or("status.eq.pending,and(status.eq.failed,attempts.lt.3),and(status.eq.done,cohort.eq.winner,comment_texts.is.null)")
    .order("cohort", { ascending: false }) // winners first
    .limit(limit);
  const rows = open ?? [];
  for (const r of rows) {
    await supabase.from("reel_analyses").update({ status: "working", attempts: r.attempts + 1 }).eq("id", r.id);
  }
  return rows;
}

export async function openCount(supabase: Db, personaId: string): Promise<number> {
  const { count } = await supabase
    .from("reel_analyses")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .or("status.eq.pending,status.eq.working,and(status.eq.failed,attempts.lt.3),and(status.eq.done,cohort.eq.winner,comment_texts.is.null)");
  return count ?? 0;
}
