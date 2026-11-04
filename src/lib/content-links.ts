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
  const key = opts.inspoUrl ? instagramKey(opts.inspoUrl) : null;
  if (!key && !opts.linkId) return;

  try {
    const supabase = createAdminClient();
    const q = supabase
      .from("content_links")
      .select("id, chat_id, message_id, status")
      .eq("persona_id", opts.personaId)
      .in("status", ["open", "shot"]);
    const { data: link } = await (opts.linkId
      ? q.eq("id", opts.linkId)
      : q.eq("url_key", key!).order("posted_at", { ascending: true }).limit(1)
    ).maybeSingle();
    if (!link) return;

    await supabase
      .from("content_links")
      .update({
        status: "uploaded",
        request_id: opts.requestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    await setMessageReaction({
      chat_id: link.chat_id,
      message_id: Number(link.message_id),
      emoji: REACTION.uploaded,
    });
    await refreshShootList(supabase, opts.personaId);
  } catch (err) {
    console.warn("[content-links] linking failed", err);
  }
}

/**
 * Called when a request gains final cuts. Flips its link to "edited" and
 * swaps the reaction so the group can tell shot-vs-finished apart.
 */
export async function markInspoEdited(requestId: string) {
  try {
    const supabase = createAdminClient();
    const { data: link } = await supabase
      .from("content_links")
      .select("id, chat_id, message_id, status")
      .eq("request_id", requestId)
      .maybeSingle();
    if (!link || link.status === "edited") return;

    await supabase
      .from("content_links")
      .update({ status: "edited", updated_at: new Date().toISOString() })
      .eq("id", link.id);

    await setMessageReaction({
      chat_id: link.chat_id,
      message_id: Number(link.message_id),
      emoji: REACTION.edited,
    });
  } catch (err) {
    console.warn("[content-links] edited marking failed", err);
  }
}
