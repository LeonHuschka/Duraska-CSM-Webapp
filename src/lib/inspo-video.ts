import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { deleteMessage, sendVideo } from "@/lib/telegram";

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
  note?: string | null
): Promise<VideoResult> {
  const { data: link } = await supabase
    .from("content_links")
    .select(
      "id, persona_id, chat_id, message_thread_id, message_id, url, video_path, video_message_id"
    )
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { linkId, ok: false, note: "no such link" };

  const fail = async (note: string) => {
    await supabase
      .from("content_links")
      .update({ video_error: note, video_fetched_at: new Date().toISOString() })
      .eq("id", linkId);
    return { linkId, ok: false, note };
  };

  let path = link.video_path;
  let bytes: Uint8Array | null = null;

  if (!path) {
    const resolved = await resolveVideoUrl(link.url);
    if (!resolved.ok) return fail(resolved.note);

    const res = await fetch(resolved.url, {
      headers: { "user-agent": UA, accept: "video/mp4,video/*;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res || !res.ok) return fail(`download failed (${res?.status ?? "no answer"})`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return fail(`too large for Telegram (${Math.round(declared / 1e6)} MB)`);
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return fail(`too large for Telegram (${Math.round(bytes.byteLength / 1e6)} MB)`);
    if (bytes.byteLength < 10_000) return fail("download was not a video");

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
      caption: caption(link.url, note ?? null),
      parse_mode: "HTML",
    });
    if (!sent.ok || !sent.result) return fail(`telegram: ${sent.error ?? "no message id"}`);
    const newId = sent.result.message_id;
    await supabase
      .from("content_links")
      .update({ message_id: newId, video_message_id: newId, video_error: null })
      .eq("id", linkId);
    // The original had nothing the new message does not. Best effort —
    // Telegram refuses to delete what is older than two days.
    const gone = await deleteMessage({ chat_id: link.chat_id, message_id: Number(link.message_id) });
    if (!gone.ok) console.warn("[inspo-video] original not deleted:", gone.error);
  }

  return { linkId, ok: true, note: "stored and posted" };
}

/**
 * Every link that has no copy yet and has not already failed, newest
 * first. Used by the webhook's follow-up call for one link and by hand
 * for the backlog.
 */
export async function pendingVideoLinks(
  supabase: Db,
  opts: { personaId?: string; limit: number }
): Promise<string[]> {
  let q = supabase
    .from("content_links")
    .select("id")
    .is("video_path", null)
    .is("video_error", null)
    .in("status", ["open", "shot", "uploaded", "edited"])
    .order("posted_at", { ascending: false })
    .limit(opts.limit);
  if (opts.personaId) q = q.eq("persona_id", opts.personaId);
  const { data } = await q;
  return (data ?? []).map((r) => r.id);
}

function caption(url: string, note: string | null): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `🔗 <b>Link:</b> ${esc(url)}`,
    `📝 <b>Notes:</b> ${note?.trim() ? esc(note.trim()) : "—"}`,
  ].join("\n");
}

async function resolveVideoUrl(
  postUrl: string
): Promise<{ ok: true; url: string } | { ok: false; note: string }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, note: "APIFY_TOKEN not set" };
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=${ACTOR_TIMEOUT_S}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postUrls: [postUrl] }),
      signal: AbortSignal.timeout((ACTOR_TIMEOUT_S + 15) * 1000),
    }
  ).catch(() => null);
  if (!res) return { ok: false, note: "resolver unreachable" };
  const items = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
  if (!res.ok || !Array.isArray(items)) return { ok: false, note: `resolver answered ${res.status}` };
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
