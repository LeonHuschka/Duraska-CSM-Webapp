import "server-only";
import { layoutNote } from "@/lib/note-layout";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { deleteMessage, instagramKey, REACTION, sendVideo, setMessageReaction } from "@/lib/telegram";
import { apifyError, apifyRunSync } from "@/lib/apify";

/**
 * Keep the inspo reel, not just its link.
 *
 * A link in the requests topic is a reel somebody liked at that moment.
 * Instagram takes posts down, age-gates them, hides them from logged-out
 * visitors — and the link is then a dead end for the model days later.
 * So the moment a link lands, the reel is fetched, stored under the
 * persona in our own bucket, and posted into the topic as the bot's own
 * message: the video, the link and any notes under it, in place of the
 * message that carried only the link. The stored copy is what the request
 * page shows next to the job.
 *
 * Fetching goes through an Apify actor that resolves a post to its CDN
 * video URL (about 0.2 cent a link); the bytes come straight from the CDN.
 */
const ACTOR = "data-slayer~instagram-post-details";
const ACTOR_TIMEOUT_S = 90;
/** Telegram takes 50 MB from a bot; a reel is one or two. */
const MAX_BYTES = 48 * 1024 * 1024;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

type Db = SupabaseClient<Database>;

export type VideoResult = { linkId: string; ok: boolean; note: string };

export async function fetchInspoVideo(
  supabase: Db,
  linkId: string,
  /** What the person wrote next to the link, if anything. */
  note?: string | null,
  /**
   * A later try, from the morning run: the original message is the only
   * place an unstored note lives, so without one it stays.
   */
  retry = false
): Promise<VideoResult> {
  const { data: link } = await supabase
    .from("content_links")
    .select(
      "id, persona_id, chat_id, message_thread_id, message_id, url, status, video_path, video_message_id, note"
    )
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { linkId, ok: false, note: "no such link" };
  // Kept with the link, so a later try still has what the sender wrote.
  if (note?.trim() && note !== link.note) {
    await supabase.from("content_links").update({ note }).eq("id", linkId);
  }
  const notes = note?.trim() ? note : link.note;

  const fail = async (note: string) => {
    await supabase
      .from("content_links")
      .update({ video_error: note, video_fetched_at: new Date().toISOString() })
      .eq("id", linkId);
    // Turn the "fetching" eyes into a shrug, so the sender sees that no
    // video is coming and the link stays a link. Only on a link nobody has
    // acted on: further along, the bot's reaction there means shot or cut,
    // and a bot holds one reaction per message.
    if (link.status === "open") {
      await setMessageReaction({
        chat_id: link.chat_id,
        message_id: Number(link.message_id),
        emoji: REACTION.noVideo,
      });
    }
    return { linkId, ok: false, note };
  };

  let path = link.video_path;
  let bytes: Uint8Array | null = null;

  if (!path) {
    const resolved = await resolveVideoUrl(link.url);
    if (!resolved.ok) return fail(resolved.note);

    bytes = await downloadVideo(resolved.url);
    if (!bytes) return fail("download failed, or not a video Telegram would take");

    path = `personas/${link.persona_id}/inspo/${linkId}.mp4`;
    const { error: upErr } = await supabase.storage
      .from("content-assets")
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) return fail(`storage: ${upErr.message}`);

    await supabase
      .from("content_links")
      .update({
        video_path: path,
        video_size: bytes.byteLength,
        video_fetched_at: new Date().toISOString(),
        video_error: null,
      })
      .eq("id", linkId);
  }

  // Into the topic as the bot's own message: the video with the link and
  // any notes under it, in place of the message that only had the link.
  // The link row moves to the new message id, because that is the message
  // the model will react to from now on.
  if (link.video_message_id == null) {
    if (!bytes) {
      const { data: blob } = await supabase.storage.from("content-assets").download(path);
      if (!blob) return fail("stored copy unreadable");
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const sent = await sendVideo({
      chat_id: link.chat_id,
      message_thread_id: link.message_thread_id,
      video: bytes,
      filename: "inspo.mp4",
      caption: caption(link.url, notes ?? null),
      parse_mode: "HTML",
    });
    if (!sent.ok || !sent.result) return fail(`telegram: ${sent.error ?? "no message id"}`);
    const newId = sent.result.message_id;
    await supabase
      .from("content_links")
      .update({ message_id: newId, video_message_id: newId, video_error: null })
      .eq("id", linkId);
    if (retry && !notes?.trim()) return { linkId, ok: true, note: "posted; original kept, its note was never stored" };
    // The original had nothing the new message does not. Best effort —
    // Telegram refuses to delete what is older than two days.
    const gone = await deleteMessage({ chat_id: link.chat_id, message_id: Number(link.message_id) });
    if (!gone.ok) {
      console.warn("[inspo-video] original not deleted:", gone.error);
      return { linkId, ok: true, note: `posted; original message ${link.message_id} NOT deleted — ${gone.error}` };
    }
    return { linkId, ok: true, note: "posted; original deleted" };
  }

  return { linkId, ok: true, note: "already had its video" };
}

/**
 * The same for a job the model started herself with an inspo link: no
 * Telegram message, so the copy is stored on the job and nothing is posted.
 * Skipped when the topic already holds a copy of that post.
 */
export async function fetchRequestInspo(
  supabase: Db,
  requestId: string
): Promise<{ ok: boolean; note: string }> {
  const { data: r } = await supabase
    .from("content_requests")
    .select("id, persona_id, inspo_link, inspo_video_path")
    .eq("id", requestId)
    .maybeSingle();
  if (!r?.inspo_link) return { ok: false, note: "no inspo link" };
  if (r.inspo_video_path) return { ok: true, note: "already had its video" };
  const key = instagramKey(r.inspo_link);
  if (key) {
    const { data: copy } = await supabase
      .from("content_links")
      .select("id")
      .eq("persona_id", r.persona_id)
      .eq("url_key", key)
      .not("video_path", "is", null)
      .limit(1);
    if (copy?.length) return { ok: true, note: "the topic has a copy" };
  }
  const fail = async (note: string) => {
    await supabase.from("content_requests").update({ inspo_video_error: note }).eq("id", requestId);
    return { ok: false, note };
  };
  const resolved = await resolveVideoUrl(r.inspo_link);
  if (!resolved.ok) return fail(resolved.note);
  const bytes = await downloadVideo(resolved.url);
  if (!bytes) return fail("download failed");
  const path = `personas/${r.persona_id}/inspo/request-${requestId}.mp4`;
  const { error } = await supabase.storage
    .from("content-assets")
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) return fail(`storage: ${error.message}`);
  await supabase
    .from("content_requests")
    .update({ inspo_video_path: path, inspo_video_error: null })
    .eq("id", requestId);
  return { ok: true, note: "stored" };
}

/**
 * The original inspo of a trial's viral reel, pasted by the team: stored
 * on the trial so every job of it shows the original beside the outlier.
 * A copy the bot already holds of that post is reused.
 */
export async function fetchTrialInspo(
  supabase: Db,
  trialId: string,
  link: string
): Promise<{ ok: boolean; note: string }> {
  const { data: t } = await supabase.from("trials").select("id, persona_id").eq("id", trialId).maybeSingle();
  if (!t) return { ok: false, note: "no such trial" };
  await supabase.from("trials").update({ inspo_link: link, inspo_video_path: null }).eq("id", trialId);
  const key = instagramKey(link);
  if (key) {
    const { data: copy } = await supabase
      .from("content_links")
      .select("video_path")
      .eq("persona_id", t.persona_id)
      .eq("url_key", key)
      .not("video_path", "is", null)
      .limit(1)
      .maybeSingle();
    if (copy?.video_path) {
      await supabase.from("trials").update({ inspo_video_path: copy.video_path }).eq("id", trialId);
      return { ok: true, note: "the topic has a copy" };
    }
  }
  const resolved = await resolveVideoUrl(link);
  if (!resolved.ok) return { ok: false, note: resolved.note };
  const bytes = await downloadVideo(resolved.url);
  if (!bytes) return { ok: false, note: "download failed" };
  const path = `personas/${t.persona_id}/trials/${trialId}/inspo.mp4`;
  const { error } = await supabase.storage
    .from("content-assets")
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) return { ok: false, note: `storage: ${error.message}` };
  await supabase.from("trials").update({ inspo_video_path: path }).eq("id", trialId);
  return { ok: true, note: "stored" };
}

/**
 * Every link that has no copy yet and has not already failed, newest
 * first. Used by the webhook's follow-up call for one link and by hand
 * for the backlog.
 */
export async function pendingVideoLinks(
  supabase: Db,
  opts: {
    personaId?: string;
    limit: number;
    /** Only links the model has not reacted to yet. */
    openOnly?: boolean;
    /** Top of the topic first, so the reposts keep the order. */
    oldestFirst?: boolean;
  }
): Promise<string[]> {
  let q = supabase
    .from("content_links")
    .select("id")
    .is("video_path", null)
    .is("video_error", null)
    .in("status", opts.openOnly ? ["open"] : ["open", "shot", "uploaded", "edited"])
    .order("posted_at", { ascending: !!opts.oldestFirst })
    .limit(opts.limit);
  if (opts.personaId) q = q.eq("persona_id", opts.personaId);
  const { data } = await q;
  return (data ?? []).map((r) => r.id);
}

/**
 * Open links whose reel could not be fetched for a reason that passes — the
 * resolver out of budget or down, Telegram refusing the upload — from the
 * last two weeks. A post that is gone, private or not a video stays failed.
 */
export async function retryableVideoLinks(supabase: Db, personaId: string, limit = 10): Promise<string[]> {
  const { data } = await supabase
    .from("content_links")
    .select("id")
    .eq("persona_id", personaId)
    .eq("status", "open")
    .is("video_path", null)
    .or('video_error.like.resolver*,video_error.like.telegram:*,video_error.like."download failed*"')
    .gte("posted_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("posted_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r) => r.id);
}

/** The note is Telegram HTML already (see entitiesToHtml); only the URL is escaped here. */
export function caption(url: string, note: string | null): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `🔗 <b>Link:</b> ${esc(url)}`,
    // The note starts on its own line under the label.
    note?.trim() ? notesBlock(note.trim(), url.length) : `📝 <b>Notes:</b> —`,
  ].join("\n");
}

/** The note laid out for the model; as written when the layout would not fit a caption. */
function notesBlock(note: string, urlLength: number): string {
  const laid = layoutNote(note);
  if (laid !== note && laid.length + urlLength + 40 <= 1024) return `\n${laid}`;
  return `📝 <b>Notes:</b>\n${note}`;
}

/**
 * The bytes of a video on Meta's CDN, or null when it is not there, not a
 * video, or too big for Telegram to accept from a bot.
 */
export async function downloadVideo(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "video/mp4,video/*;q=0.9,*/*;q=0.5" },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 10_000) return null;
  return bytes;
}

/**
 * The same for a Facebook reel or video, through an actor that reads
 * Facebook (about half a cent a video). Only winners need this — inspo
 * links are Instagram.
 */
const FB_ACTOR = "apple_yang~facebook-video-audio-downloader";

export async function resolveFacebookVideoUrl(
  postUrl: string
): Promise<{ ok: true; url: string } | { ok: false; note: string }> {
  if (!process.env.APIFY_TOKEN && !process.env.APIFY_TOKEN_2) return { ok: false, note: "APIFY_TOKEN not set" };
  const res = await apifyRunSync(FB_ACTOR, { videoUrls: [postUrl] }, {
    query: { timeout: ACTOR_TIMEOUT_S },
    signal: AbortSignal.timeout((ACTOR_TIMEOUT_S + 15) * 1000),
  }).catch(() => null);
  if (!res) return { ok: false, note: "resolver unreachable" };
  if (!res.ok) return { ok: false, note: `resolver answered ${await apifyError(res)}` };
  const items = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
  if (!Array.isArray(items)) return { ok: false, note: `resolver answered ${res.status}` };
  const item = items[0];
  if (!item) return { ok: false, note: "video not readable" };
  if (typeof item.errMsg === "string" && item.errMsg) return { ok: false, note: item.errMsg.slice(0, 80) };
  const url = typeof item.videoUrl === "string" && item.videoUrl ? item.videoUrl : null;
  if (!url) return { ok: false, note: "no video url in the answer" };
  return { ok: true, url };
}

export async function resolveVideoUrl(
  postUrl: string
): Promise<{ ok: true; url: string } | { ok: false; note: string }> {
  if (!process.env.APIFY_TOKEN && !process.env.APIFY_TOKEN_2) return { ok: false, note: "APIFY_TOKEN not set" };
  const res = await apifyRunSync(ACTOR, { postUrls: [postUrl] }, {
    query: { timeout: ACTOR_TIMEOUT_S },
    signal: AbortSignal.timeout((ACTOR_TIMEOUT_S + 15) * 1000),
  }).catch(() => null);
  if (!res) return { ok: false, note: "resolver unreachable" };
  if (!res.ok) return { ok: false, note: `resolver answered ${await apifyError(res)}` };
  const items = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
  if (!Array.isArray(items)) return { ok: false, note: `resolver answered ${res.status}` };
  const item = items[0];
  if (!item) return { ok: false, note: "post not readable — gone, private or age-gated" };
  if (item.error) return { ok: false, note: `post not readable — ${String(item.error).slice(0, 80)}` };
  if (item.is_video === false || item.is_video === "False") return { ok: false, note: "not a video" };

  // The best rendition Instagram offers, then whatever it calls the video.
  const versions = item.video_versions as { url?: string; height?: number }[] | undefined;
  const best = Array.isArray(versions)
    ? versions.filter((v) => v?.url).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
    : undefined;
  const url = best?.url ?? (typeof item.video_url === "string" ? item.video_url : null);
  if (!url) return { ok: false, note: "no video url in the answer" };
  return { ok: true, url };
}
