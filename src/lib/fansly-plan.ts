import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDocument, sendMessage, sendVideo } from "@/lib/telegram";
import { videoInfo } from "@/lib/video-info";
import { addDays, atTime, dayKey, hhmm } from "@/components/planner/planner-utils";

/**
 * The Fansly calendar. Posts go up at set times of the LA day (Fansly's
 * clock). The app fills the free times with Fansly cuts as drafts, each
 * with a caption Claude writes from the cut's picture — or only emojis
 * when the picture does not say what happens. Approved posts go to the
 * VA the day before they are due, so she can set them in Fansly's own
 * scheduler from the Philippines.
 */

export const FANSLY_TZ = "America/Los_Angeles";
export const DEFAULT_SLOTS = ["11:00", "20:00"];
export const DEFAULT_HASHTAGS =
  "#brunette #naturalbeauty #girlnextdoor #hotbrunette #squirting #wetpussy #prettyface #ass #booty #tits #boobs #pussy #curves";
/** How far ahead the calendar is filled: the days after today it shows (two weeks with today). */
export const FILL_DAYS = 13;

type Db = ReturnType<typeof createAdminClient>;

export type FanslySchedule = { slots: string[]; overrides: Record<string, string[]>; hashtags: string };

const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const cleanSlots = (list: unknown): string[] =>
  Array.from(new Set((Array.isArray(list) ? list : []).filter(isTime))).sort();

export async function readSchedule(db: Db, personaId: string): Promise<FanslySchedule> {
  const { data } = await db.from("fansly_schedule").select("slots, overrides, hashtags").eq("persona_id", personaId).maybeSingle();
  const overrides: Record<string, string[]> = {};
  const raw = data?.overrides && typeof data.overrides === "object" && !Array.isArray(data.overrides) ? data.overrides : {};
  for (const [day, list] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) overrides[day] = cleanSlots(list);
  }
  return {
    slots: data ? cleanSlots(data.slots) : DEFAULT_SLOTS,
    overrides,
    hashtags: data?.hashtags ?? DEFAULT_HASHTAGS,
  };
}

/** The times of one LA day: its own, else the usual ones. */
export const slotsOf = (s: FanslySchedule, day: string) => s.overrides[day] ?? s.slots;

// ── Captions ──

const EMOJI = ["👀", "🔥", "😈", "💦", "🥵", "😏", "🫦", "🍑", "💋", "👅", "🤤", "✨"];
const emojiOnly = () => {
  const pick = [...EMOJI].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
  return pick.join("");
};

const Caption = z.object({
  /** True only when the picture makes clear what happens in the video. */
  sure: z.boolean(),
  /** One short first-person line, or only emojis when not sure. No hashtags. */
  caption: z.string(),
});

const SYSTEM = `You write captions for a creator's posts on Fansly, an adult subscription site; her fans are there for sexual content. You get one frame of the short video.
The caption is her voice whispering to a fan: one very short line, first person, lowercase, sexual and suggestive — what she wants done to her, what she is about to do, how it feels. Short and direct hits harder than clever or descriptive.
Keep it to about 3 to 10 words. Do not describe the picture, do not mention clothes, the room or the camera. Now and then — about one caption in four — it may end in a short call to action (e.g. "come see the rest", "check your dms").
End with exactly one fitting emoji, written straight after the last word with no space.
If the picture does not make clear what is going on, set sure to false and the caption to one or two fitting emojis only.
Never add hashtags or quotes; hashtags are added afterwards.`;

/** Her voice: the captions the team wrote that hit the way Fansly needs. */
const STYLE = ["could you please finish me up so I fall asleep now👀", "omg I like it that way👅"];

/** A caption for a cut from its picture: Claude's line, or emojis when unsure. */
export async function captionFor(
  db: Db,
  thumbnailPath: string | null,
  examples: string[]
): Promise<{ text: string; source: "ai" | "emoji" }> {
  if (!thumbnailPath || !process.env.ANTHROPIC_API_KEY) return { text: emojiOnly(), source: "emoji" };
  const { data: file } = await db.storage.from("content-assets").download(thumbnailPath);
  if (!file) return { text: emojiOnly(), source: "emoji" };
  const type = file.type && /^image\/(jpeg|png|webp|gif)$/.test(file.type) ? file.type : "image/jpeg";
  const shown = examples.slice(0, 8).map((e) => `- ${e}`).join("\n");
  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(Caption) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: type as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: Buffer.from(await file.arrayBuffer()).toString("base64"),
              },
            },
            { type: "text", text: `Captions in her voice — match how short and sexual they are, never copy one:\n${shown}\n\nWrite the caption for this one.` },
          ],
        },
      ],
    });
    // A refused or unreadable answer is the same as an unclear picture.
    const out = res.stop_reason === "refusal" ? null : res.parsed_output;
    const line = out?.caption.replace(/#[^\s#]+/g, "").trim();
    if (!out || !line) return { text: emojiOnly(), source: "emoji" };
    return { text: line, source: out.sure ? "ai" : "emoji" };
  } catch (err) {
    console.warn("[fansly] caption failed", err instanceof Error ? err.message : err);
    return { text: emojiOnly(), source: "emoji" };
  }
}

/** The line, then the hashtags, the way the captions are posted. */
export const withHashtags = (line: string, hashtags: string) => [line.trim(), hashtags.trim()].filter(Boolean).join(" ");

/** Her past captions without their hashtags, newest first — the voice to write in. */
/**
 * The captions to write like: the team's own, never the app's — learning
 * from its own lines would only repeat them.
 */
export async function examplesOf(db: Db, personaId: string): Promise<string[]> {
  const { data } = await db
    .from("fansly_posts")
    .select("caption, caption_source")
    .eq("persona_id", personaId)
    .or("caption_source.is.null,caption_source.eq.manual")
    .order("created_at", { ascending: false })
    .limit(40);
  const lines = (data ?? []).map((p) => p.caption.replace(/#[^\s#]+/g, "").trim()).filter((l) => l.length > 3);
  return Array.from(new Set([...STYLE, ...lines])).slice(0, 10);
}

/** New captions for the drafts still to come whose caption the app wrote. */
export async function recaptionDrafts(db: Db, personaId: string): Promise<number> {
  const [{ data: drafts }, schedule, examples] = await Promise.all([
    db
      .from("fansly_posts")
      .select("id, asset_id")
      .eq("persona_id", personaId)
      .eq("status", "draft")
      .in("caption_source", ["ai", "emoji"])
      .gte("scheduled_for", new Date().toISOString()),
    readSchedule(db, personaId),
    examplesOf(db, personaId),
  ]);
  if (!drafts?.length) return 0;
  const { data: assets } = await db.from("content_assets").select("id, thumbnail_path").in("id", drafts.map((d) => d.asset_id));
  const thumb = new Map((assets ?? []).map((a) => [a.id, a.thumbnail_path]));
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, drafts.length) }, async () => {
      while (next < drafts.length) {
        const d = drafts[next++];
        const c = await captionFor(db, thumb.get(d.asset_id) ?? null, examples);
        const { error } = await db
          .from("fansly_posts")
          .update({ caption: withHashtags(c.text, schedule.hashtags), caption_source: c.source })
          .eq("id", d.id)
          .eq("status", "draft");
        if (!error) done++;
      }
    })
  );
  return done;
}

// ── Filling the calendar ──

/**
 * The free times of the next days, each with a Fansly cut not planned
 * before — one cut per reel first, oldest first — as drafts to approve.
 */
export async function fillDrafts(db: Db, personaId: string, days = FILL_DAYS): Promise<{ created: number; short: number }> {
  const schedule = await readSchedule(db, personaId);
  const start = addDays(dayKey(new Date(), FANSLY_TZ), 1);
  const end = addDays(start, days);

  const [{ data: planned }, { data: assets }] = await Promise.all([
    db.from("fansly_posts").select("asset_id, scheduled_for").eq("persona_id", personaId),
    db
      .from("content_assets")
      .select("id, request_id, thumbnail_path, uploaded_at, content_requests!inner(persona_id)")
      .eq("content_requests.persona_id", personaId)
      .eq("stage", "fansly")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: true }),
  ]);

  const taken = new Set(
    (planned ?? []).map((p) => {
      const at = new Date(p.scheduled_for);
      return `${dayKey(at, FANSLY_TZ)} ${hhmm(at, FANSLY_TZ)}`;
    })
  );
  const usedAssets = new Set((planned ?? []).map((p) => p.asset_id));
  const free = (assets ?? []).filter((a) => !usedAssets.has(a.id));
  const usedReels = new Set((assets ?? []).filter((a) => usedAssets.has(a.id)).map((a) => a.request_id));
  // A reel not on Fansly yet before another cut of one that is; one cut a reel first.
  const firsts: typeof free = [];
  const rest: typeof free = [];
  const seen = new Set<string>();
  for (const a of free) {
    if (!usedReels.has(a.request_id) && !seen.has(a.request_id)) {
      firsts.push(a);
      seen.add(a.request_id);
    } else rest.push(a);
  }
  const pool = [...firsts, ...rest];

  const wanted: { day: string; time: string }[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    for (const time of slotsOf(schedule, d)) if (!taken.has(`${d} ${time}`)) wanted.push({ day: d, time });
  }
  const pairs = wanted.slice(0, pool.length).map((w, i) => ({ ...w, asset: pool[i] }));
  if (!pairs.length) return { created: 0, short: wanted.length };

  const examples = await examplesOf(db, personaId);
  // A few captions at once: each is a picture and a short answer.
  const captions: { text: string; source: "ai" | "emoji" }[] = new Array(pairs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pairs.length) }, async () => {
      while (next < pairs.length) {
        const i = next++;
        captions[i] = await captionFor(db, pairs[i].asset.thumbnail_path, examples);
      }
    })
  );

  const { error } = await db.from("fansly_posts").insert(
    pairs.map((p, i) => ({
      persona_id: personaId,
      asset_id: p.asset.id,
      scheduled_for: atTime(p.day, p.time, FANSLY_TZ).toISOString(),
      caption: withHashtags(captions[i].text, schedule.hashtags),
      caption_source: captions[i].source,
      status: "draft",
      fyp: true,
    }))
  );
  if (error) throw new Error(error.message);
  return { created: pairs.length, short: wanted.length - pairs.length };
}

// ── Sending ──

/** Telegram takes up to 50 MB from a bot; a bigger cut goes as a link. */
const MAX_VIDEO_BYTES = 49 * 1024 * 1024;
const MAX_CAPTION = 1024;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Fri, 13 Nov" — the day in LA. */
function laDate(iso: string) {
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: FANSLY_TZ, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(iso)
  );
  const i = d.indexOf(" ");
  return i > 0 ? `${d.slice(0, i)},${d.slice(i)}` : d;
}

/**
 * The task in the VA's Fansly topic: who, the day and the time (LA) on lines
 * of their own, the price, FYP — every Fansly post goes there — the note,
 * the caption to copy, and the cut as a playable video at its true shape.
 * Returns what went wrong, or null.
 */
export async function deliver(postId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: post } = await db
    .from("fansly_posts")
    .select("id, persona_id, asset_id, scheduled_for, caption, price, note")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return "Plan not found";
  const [{ data: asset }, { data: cfg }] = await Promise.all([
    db.from("content_assets").select("file_path, file_name, mime_type, size_bytes").eq("id", post.asset_id).maybeSingle(),
    db
      .from("telegram_config")
      .select("chat_id, fansly_thread_id, va_username, fansly_va_username")
      .eq("persona_id", post.persona_id)
      .maybeSingle(),
  ]);
  if (!asset) return "Cut not found";
  if (!cfg?.chat_id || !cfg.fansly_thread_id) return "No Fansly topic set for this model";

  const price = post.price ? Number(post.price) : null;
  const va = (cfg.fansly_va_username ?? cfg.va_username)?.replace(/^@/, "");
  const head = [
    `📅 <b>Fansly post</b>${va ? ` · @${esc(va)}` : ""}`,
    "",
    `🗓 <b>${esc(laDate(post.scheduled_for))}</b>`,
    `⏰ <b>${esc(hhmm(new Date(post.scheduled_for), FANSLY_TZ))}</b> LA time`,
    price ? `💰 PPV $${price.toFixed(2)}` : "🆓 Free post",
    "🔥 FYP post",
    post.note ? `📝 ${esc(post.note)}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const body = post.caption ? `\n\n<b>Caption</b> (tap to copy):\n<pre>${esc(post.caption)}</pre>` : "\n\n<i>No caption</i>";
  const together = head + body;
  const fits = together.length <= MAX_CAPTION;
  const thread = { chat_id: cfg.chat_id, message_thread_id: cfg.fansly_thread_id };

  let messageId: number | null = null;
  let error: string | null = null;
  if ((asset.size_bytes ?? 0) <= MAX_VIDEO_BYTES) {
    const { data: file } = await db.storage.from("content-assets").download(asset.file_path);
    if (file) {
      // A playable video at its true shape: Telegram stretched it when it had
      // to guess, so width, height and length come from the file's header.
      // A file whose header says nothing goes as a plain file instead.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = videoInfo(bytes);
      const caption = fits ? together : head;
      const sent = info
        ? await sendVideo({
            ...thread,
            video: bytes,
            filename: asset.file_name,
            mime: asset.mime_type,
            width: info.width,
            height: info.height,
            duration: info.duration,
            caption,
            parse_mode: "HTML",
          })
        : await sendDocument({ ...thread, file: bytes, filename: asset.file_name, mime: asset.mime_type, caption, parse_mode: "HTML" });
      if (sent.ok) messageId = sent.result?.message_id ?? null;
      else error = sent.error ?? "Video not sent";
    } else error = "Video could not be read";
  }
  if (messageId == null) {
    // Too big for a bot, or the upload failed: the task with a download link.
    const { data: signed } = await db.storage.from("content-assets").createSignedUrl(asset.file_path, 7 * 24 * 3600);
    const sent = await sendMessage({
      ...thread,
      text: together + (signed?.signedUrl ? `\n\n<a href="${esc(signed.signedUrl)}">⬇️ Download the video</a>` : ""),
      parse_mode: "HTML",
    });
    if (sent.ok) {
      messageId = sent.result?.message_id ?? null;
      error = null;
    } else error = sent.error ?? error ?? "Not sent";
  } else if (!fits) {
    // The caption did not fit under the video: it follows as a reply.
    await sendMessage({ ...thread, text: body.trim(), parse_mode: "HTML", reply_to_message_id: messageId });
  }

  await db
    .from("fansly_posts")
    .update({ status: messageId != null ? "sent" : "failed", message_id: messageId, error })
    .eq("id", post.id);
  return messageId != null ? null : error;
}

/**
 * The cron's part: approved posts due tomorrow (LA) or sooner go to the VA
 * now — the day before, or at once when approved late.
 */
export async function sendDue(deadline: number): Promise<{ id: string; error: string | null }[]> {
  const db = createAdminClient();
  const until = atTime(addDays(dayKey(new Date(), FANSLY_TZ), 2), "00:00", FANSLY_TZ).toISOString();
  const { data: due } = await db
    .from("fansly_posts")
    .select("id")
    .eq("status", "approved")
    .lt("scheduled_for", until)
    .order("scheduled_for", { ascending: true })
    .limit(10);
  const out: { id: string; error: string | null }[] = [];
  for (const p of due ?? []) {
    if (Date.now() > deadline - 30_000) break;
    // Claimed first, so two runs never send the same post twice.
    const { data: claimed } = await db
      .from("fansly_posts")
      .update({ status: "sending" })
      .eq("id", p.id)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    out.push({ id: p.id, error: await deliver(p.id) });
  }
  return out;
}
