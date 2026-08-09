import "server-only";

/**
 * The wording the pipeline alert uses, kept apart from the cron route so a
 * simulation can show what would be said without saying it.
 */

export type Cfg = {
  persona_id: string;
  chat_id: number | null;
  talk_thread_id: number | null;
  model_username: string | null;
  va_username: string | null;
  manager_username: string | null;
  min_ready_to_post: number;
  min_open_links: number;
  max_unedited: number;
  last_alert_at: string | null;
};

/**
 * Work out where the pipeline is actually blocked and address the person
 * who can unblock it — a generic "we need content" helps nobody.
 */
export function buildAlert(x: {
  cfg: Cfg;
  openLinks: number;
  shotNotUploaded: number;
  unedited: number;
  readyToPost: number;
  runwayDays: number;
}): string | null {
  const { cfg } = x;
  const at = (u: string | null) => (u ? `@${u.replace(/^@/, "")}` : "");
  const lines: string[] = [];

  const runwayLow = x.readyToPost < cfg.min_ready_to_post;

  // Editing is the bottleneck: plenty shot, little finished.
  if (runwayLow && x.unedited >= cfg.max_unedited) {
    lines.push(
      `✂️ <b>Editing is the bottleneck</b> ${at(cfg.va_username)}`,
      `${x.unedited} takes waiting, only ${x.readyToPost} ready to post (~${x.runwayDays}d left).`,
      `Please prioritise cutting today.`
    );
  }
  // Model is the bottleneck: links available, not enough shot.
  else if (runwayLow && x.openLinks > 0 && x.unedited < cfg.max_unedited) {
    lines.push(
      `🎬 <b>We need more raw takes</b> ${at(cfg.model_username)}`,
      `Only ${x.readyToPost} reels ready to post (~${x.runwayDays}d left) and ${x.openLinks} inspo links are still open.`,
      `Could you shoot a few today? 💪`
    );
  }
  // Inspo is the bottleneck.
  else if (x.openLinks < cfg.min_open_links) {
    lines.push(
      `🔗 <b>Inspo running low</b> ${at(cfg.manager_username)}`,
      `Only ${x.openLinks} open links left. Time to drop new references.`
    );
  }

  // Nudge for shot-but-not-uploaded, appended to whatever else we say.
  if (x.shotNotUploaded >= 3) {
    lines.push(
      ``,
      `📤 ${at(cfg.model_username)} ${x.shotNotUploaded} reels are marked as shot but not uploaded yet.`
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
