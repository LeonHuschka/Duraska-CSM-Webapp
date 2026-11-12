import "server-only";
import { isVideoPath } from "@/lib/feed-media";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { accountLabel } from "@/lib/account-analytics";
import { sendMessage } from "@/lib/telegram";
import {
  containerStatus,
  createFeedContainer,
  createReelContainer,
  latestMedia,
  mediaPermalink,
  publishContainer,
  refreshToken,
} from "@/lib/instagram-api";

/**
 * The publisher: every post in the planner whose time has come goes out
 * through Instagram's API — reels from the vault, and feed posts (one
 * picture or a carousel) uploaded in the planner.
 *
 * Instagram takes a reel in two steps — it fetches and processes the
 * video (a minute or two), then publishes it — so a post moves through
 * states, each saved before the next call:
 *
 *   queued → uploading (container made, Instagram processing)
 *          → publishing (publish asked for) → published
 *
 * A run that dies halfway leaves a state the next run picks up: an
 * unfinished upload is checked again, and a publish whose answer got lost
 * is looked up instead of asked for twice — a reel must never go out twice.
 * Failures are retried twice, then the post stays "failed" in the planner
 * and the account's topic hears about it.
 */
type Db = SupabaseClient<Database>;

const MAX_ATTEMPTS = 3;
/** Instagram gives up on a container after a day; we much sooner. */
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
/** Due a little early is fine — the timer runs every five minutes. */
const EARLY_MS = 60_000;

type Slot = Database["public"]["Tables"]["schedule_slots"]["Row"];
type Conn = { ig_user_id: string; access_token: string; username: string | null };

export type PublishResult = { id: string; state: string; note?: string };

/** Everything due, until the time is up. Pass a slot id to do just that one. */
export async function publishDue(
  supabase: Db,
  opts: { slotId?: string; deadline: number }
): Promise<PublishResult[]> {
  let q = supabase
    .from("schedule_slots")
    .select("*")
    .eq("auto_publish", true)
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date(Date.now() + EARLY_MS).toISOString())
    .or("publish_state.is.null,publish_state.in.(queued,uploading,publishing)")
    .order("scheduled_for", { ascending: true })
    .limit(10);
  if (opts.slotId) q = q.eq("id", opts.slotId);
  const { data: due } = await q;
  const out: PublishResult[] = [];
  for (const slot of due ?? []) {
    if (Date.now() > opts.deadline - 20_000) break;
    out.push(await publishOne(supabase, slot, opts.deadline));
  }
  return out;
}

async function publishOne(supabase: Db, slot: Slot, deadline: number): Promise<PublishResult> {
  const { data: conn } = await supabase
    .from("ig_connections")
    .select("ig_user_id, access_token, username")
    .eq("account_id", slot.account_id ?? "")
    .maybeSingle();
  // Not connected (yet): the post waits instead of failing, and goes out
  // on the first run after the account is connected.
  if (!conn) return { id: slot.id, state: "waiting", note: "Instagram is not connected" };

  // How far this run got: an error after publish was asked for must not
  // put the post back in the queue — it may well be live.
  let phase: "upload" | "publish" = slot.publish_state === "publishing" ? "publish" : "upload";
  try {
    let s = slot;
    if (!s.publish_state || s.publish_state === "queued") {
      // Claim it: a second run arriving now finds it taken.
      const { data: claimed } = await supabase
        .from("schedule_slots")
        .update({
          publish_state: "uploading",
          publish_started_at: new Date().toISOString(),
          publish_attempts: s.publish_attempts + 1,
          publish_error: null,
        })
        .eq("id", s.id)
        .or("publish_state.is.null,publish_state.eq.queued")
        .select("*")
        .maybeSingle();
      if (!claimed) return { id: s.id, state: "taken" };
      s = claimed;
      let container: string;
      if (s.media_kind === "image" || s.media_kind === "carousel") {
        const paths = s.media_paths ?? [];
        const urls = await signedPaths(supabase, paths);
        if (!urls) return fail(supabase, s, "A picture or video of the post is gone", true);
        container = await createFeedContainer(conn.ig_user_id, conn.access_token, {
          items: urls.map((url, i) => ({ url, video: isVideoPath(paths[i]) })),
          caption: s.caption,
          waitUntil: deadline - 40_000,
        });
      } else {
        const videoUrl = await signedVideo(supabase, s.asset_id);
        if (!videoUrl) return fail(supabase, s, "The video is gone from the vault", true);
        container = await createReelContainer(conn.ig_user_id, conn.access_token, {
          videoUrl,
          caption: s.caption,
          shareToFeed: s.share_to_feed,
          trial: s.trial_reel,
        });
      }
      await supabase.from("schedule_slots").update({ ig_container_id: container }).eq("id", s.id);
      s = { ...s, ig_container_id: container };
    }

    if (!s.ig_container_id) return fail(supabase, s, "Upload lost its container");

    // Processing: ask every few seconds while this run has time.
    if (s.publish_state === "uploading") {
      for (;;) {
        const st = await containerStatus(s.ig_container_id, conn.access_token);
        if (st.code === "FINISHED") break;
        if (st.code === "PUBLISHED") return done(supabase, s, conn, null);
        if (st.code === "ERROR" || st.code === "EXPIRED") {
          return fail(supabase, s, `Instagram could not process the ${what(s)}${st.detail ? `: ${st.detail}` : ""}`);
        }
        const started = s.publish_started_at ? new Date(s.publish_started_at).getTime() : Date.now();
        if (Date.now() - started > UPLOAD_TIMEOUT_MS) return fail(supabase, s, `Instagram took too long to process the ${what(s)}`);
        if (Date.now() > deadline - 25_000) return { id: s.id, state: "processing" };
        await new Promise((r) => setTimeout(r, 5_000));
      }
      await supabase.from("schedule_slots").update({ publish_state: "publishing" }).eq("id", s.id);
      phase = "publish";
      const mediaId = await publishContainer(conn.ig_user_id, s.ig_container_id, conn.access_token);
      return done(supabase, s, conn, mediaId);
    }

    // "publishing" found by a later run: the answer got lost. Ask the
    // container rather than publishing a second time.
    const st = await containerStatus(s.ig_container_id, conn.access_token);
    if (st.code === "PUBLISHED") return done(supabase, s, conn, null);
    if (st.code === "FINISHED") {
      const mediaId = await publishContainer(conn.ig_user_id, s.ig_container_id, conn.access_token);
      return done(supabase, s, conn, mediaId);
    }
    return fail(supabase, s, `Publish did not finish (${st.code})`);
  } catch (err) {
    const why = err instanceof Error ? err.message : "Publishing failed";
    if (phase === "publish") {
      return fail(supabase, slot, `${why} — check the profile before retrying, it may be live`, true);
    }
    return fail(supabase, slot, why);
  }
}

async function signedVideo(supabase: Db, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  const { data: asset } = await supabase
    .from("content_assets")
    .select("file_path")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset?.file_path) return null;
  // Long enough for Instagram to come back for it while processing.
  const { data } = await supabase.storage.from("content-assets").createSignedUrl(asset.file_path, 6 * 3600);
  return data?.signedUrl ?? null;
}

function what(s: Slot): string {
  return s.media_kind === "carousel" ? "carousel" : s.media_kind === "image" ? "picture" : "video";
}

/** Signed links to every picture and video of a feed post, or null if one is missing. */
async function signedPaths(supabase: Db, paths: string[]): Promise<string[] | null> {
  if (!paths.length) return null;
  const { data } = await supabase.storage.from("content-assets").createSignedUrls(paths, 6 * 3600);
  const urls = paths.map((p) => data?.find((u) => u.path === p)?.signedUrl ?? null);
  return urls.every(Boolean) ? (urls as string[]) : null;
}

async function done(supabase: Db, s: Slot, conn: Conn, mediaId: string | null): Promise<PublishResult> {
  let id = mediaId;
  let link = id ? await mediaPermalink(id, conn.access_token) : null;
  if (!id) {
    const last = await latestMedia(conn.ig_user_id, conn.access_token);
    id = last?.id ?? null;
    link = last?.permalink ?? null;
  }
  const now = new Date().toISOString();
  await supabase
    .from("schedule_slots")
    .update({
      status: "posted",
      posted_at: now,
      post_url: link,
      ig_media_id: id,
      publish_state: "published",
      publish_error: null,
    })
    .eq("id", s.id);
  await tell(supabase, s, (handle, title) =>
    [`✅ <b>Posted on ${handle}</b>`, `${title}${s.trial_reel ? " · as a trial reel" : ""}`, link ? `🔗 ${link}` : ""]
      .filter(Boolean)
      .join("\n")
  );
  return { id: s.id, state: "published", note: link ?? undefined };
}

async function fail(supabase: Db, s: Slot, why: string, final = false): Promise<PublishResult> {
  const { data: now } = await supabase.from("schedule_slots").select("publish_attempts").eq("id", s.id).maybeSingle();
  const attempts = Math.max(now?.publish_attempts ?? s.publish_attempts, 1);
  const giveUp = final || attempts >= MAX_ATTEMPTS;
  await supabase
    .from("schedule_slots")
    .update({
      publish_state: giveUp ? "failed" : "queued",
      publish_error: why.slice(0, 500),
      ig_container_id: null,
    })
    .eq("id", s.id);
  if (giveUp) {
    await tell(supabase, s, (handle, title) =>
      [`⚠️ <b>Auto-post failed on ${handle}</b>`, `${title}: ${esc(why)}`, `Fix or retry it in the planner.`].join("\n")
    );
  }
  return { id: s.id, state: giveUp ? "failed" : "retry", note: why };
}

/** A line in the account's own topic, if it has one. */
async function tell(supabase: Db, s: Slot, text: (handle: string, title: string) => string) {
  try {
    const { data: a } = await supabase
      .from("accounts")
      .select("handle, telegram_chat_id, telegram_thread_id")
      .eq("id", s.account_id ?? "")
      .maybeSingle();
    if (!a?.telegram_chat_id) return;
    const { data: r } = s.request_id
      ? await supabase.from("content_requests").select("title").eq("id", s.request_id).maybeSingle()
      : { data: null };
    await sendMessage({
      chat_id: a.telegram_chat_id,
      message_thread_id: a.telegram_thread_id,
      text: text(
        esc(accountLabel(a.handle)),
        `<b>${esc(r?.title ?? (s.media_kind === "carousel" ? "A carousel" : s.media_kind === "image" ? "A feed post" : "A reel"))}</b>`
      ),
      disable_notification: true,
    });
  } catch (err) {
    console.warn("[auto-publish] telegram", err);
  }
}

/**
 * Tokens last 60 days and renew for another 60 while valid. Run daily:
 * anything inside its last three weeks is renewed.
 */
export async function refreshIgTokens(supabase: Db): Promise<string[]> {
  const soon = new Date(Date.now() + 21 * 86_400_000).toISOString();
  const { data: conns } = await supabase
    .from("ig_connections")
    .select("account_id, access_token, username, token_expires_at")
    .lt("token_expires_at", soon);
  const notes: string[] = [];
  for (const c of conns ?? []) {
    try {
      const fresh = await refreshToken(c.access_token);
      await supabase
        .from("ig_connections")
        .update({ access_token: fresh.token, token_expires_at: fresh.expiresAt, refreshed_at: new Date().toISOString() })
        .eq("account_id", c.account_id);
      notes.push(`${c.username}: renewed`);
    } catch (err) {
      notes.push(`${c.username}: ${err instanceof Error ? err.message : "not renewed"}`);
    }
  }
  return notes;
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
