import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { instagramKey, setMessageReaction, REACTION } from "@/lib/telegram";

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
}) {
  if (!opts.inspoUrl) return;
  const key = instagramKey(opts.inspoUrl);
  if (!key) return;

  try {
    const supabase = createAdminClient();
    const { data: link } = await supabase
      .from("content_links")
      .select("id, chat_id, message_id, status")
      .eq("persona_id", opts.personaId)
      .eq("url_key", key)
      .in("status", ["open", "shot"])
      .order("posted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
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
