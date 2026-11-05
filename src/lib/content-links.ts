import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { instagramKey, setMessageReaction, REACTION } from "@/lib/telegram";
import { refreshShootList } from "@/lib/shoot-list";

/**
 * Tie a freshly-created content_request to the Telegram inspo link it came
 * from, matched on the Instagram shortcode in the inspo URL the model
 * pasted. Reacts on the original group message so everyone sees it landed.
 *
 * Best-effort throughout: an upload must never fail because Telegram is
 * unreachable or the link was never posted in the group.
 */
export async function linkInspoToRequest(opts: {
  personaId: string;
  requestId: string;
  inspoUrl: string | null;
  /** The link itself, when the upload came from its own page. */
  linkId?: string;
}) {
  try {
    const supabase = createAdminClient();
    const key = opts.inspoUrl ? await inspoKey(supabase, opts.inspoUrl) : null;
    if (!key && !opts.linkId) return;
    const q = supabase
      .from("content_links")
      .select("id, chat_id, message_id, status, url_key")
      .eq("persona_id", opts.personaId)
      .in("status", ["open", "shot"]);
    const { data: link } = await (opts.linkId
      ? q.eq("id", opts.linkId)
      : q.eq("url_key", key!).order("posted_at", { ascending: true }).limit(1)
    ).maybeSingle();
    if (!link) return;

    // The same reel posted more than once is shot once: every open
    // posting of it goes along, or the others stay in the backlog for ever.
    const { data: same } = await supabase
      .from("content_links")
      .update({
        status: "uploaded",
        request_id: opts.requestId,
        updated_at: new Date().toISOString(),
      })
      .eq("persona_id", opts.personaId)
      .eq("url_key", link.url_key)
      .in("status", ["open", "shot"])
      .select("chat_id, message_id");

    for (const m of same?.length ? same : [link]) {
      await setMessageReaction({
        chat_id: m.chat_id,
        message_id: Number(m.message_id),
        emoji: REACTION.uploaded,
      });
    }
    await refreshShootList(supabase, opts.personaId);
  } catch (err) {
    console.warn("[content-links] linking failed", err);
  }
}

/**
 * The reel an inspo URL means: its Instagram shortcode, or — when she
 * copied the Telegram message instead (t.me/c/<chat>/<topic>/<message>) —
 * the shortcode of the link posted in that message.
 */
async function inspoKey(db: ReturnType<typeof createAdminClient>, url: string): Promise<string | null> {
  const key = instagramKey(url);
  if (key) return key;
  const m = url.match(/t\.me\/c\/(\d+)\/(?:\d+\/)?(\d+)/);
  if (!m) return null;
  const { data } = await db
    .from("content_links")
    .select("url_key")
    .eq("chat_id", Number(`-100${m[1]}`))
    .or(`message_id.eq.${m[2]},video_message_id.eq.${m[2]}`)
    .limit(1)
    .maybeSingle();
  return data?.url_key ?? null;
}

/**
 * Called when a request gains final cuts. Flips its link to "edited" and
 * swaps the reaction so the group can tell shot-vs-finished apart.
 */
export async function markInspoEdited(requestId: string) {
  try {
    const supabase = createAdminClient();
    // Every posting of the reel carries the job, so every one turns.
    const { data: links } = await supabase
      .from("content_links")
      .update({ status: "edited", updated_at: new Date().toISOString() })
      .eq("request_id", requestId)
      .neq("status", "edited")
      .select("chat_id, message_id");

    for (const link of links ?? []) {
      await setMessageReaction({
        chat_id: link.chat_id,
        message_id: Number(link.message_id),
        emoji: REACTION.edited,
      });
    }
  } catch (err) {
    console.warn("[content-links] edited marking failed", err);
  }
}
