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
 * Where the pipeline is about to run dry, and who can do something about
 * it today. The pool is measured in reels, not cuts — four cuts of one
 * reel are a day of posting — and when it is low the editing queue says
 * whose turn it is: empty, the model has to shoot; full, the editor has to
 * catch up; somewhere between, both. Friendly on purpose: these land in a
 * group chat every morning it applies, and nagging wears off.
 */
export function buildAlert(x: {
  cfg: Cfg;
  readyReels: number;
  readyCuts: number;
  toEdit: number;
  openLinks: number;
  shotNotUploaded: number;
}): string | null {
  const { cfg } = x;
  const at = (u: string | null) => (u ? `@${u.replace(/^@/, "")}` : "");
  const lines: string[] = [];

  const poolLow = x.readyReels < cfg.min_ready_to_post;
  const queueFull = x.toEdit >= cfg.max_unedited;
  const queueEmpty = x.toEdit === 0;
  const pool =
    x.readyReels === 1
      ? `1 reel (${x.readyCuts} ${x.readyCuts === 1 ? "cut" : "cuts"})`
      : `${x.readyReels} reels (${x.readyCuts} cuts)`;

  if (poolLow) {
    lines.push(`☀️ Ready-to-post is getting low — ${pool} left.`);
    if (queueEmpty || !queueFull) {
      lines.push(`${at(cfg.model_username)}, try to shoot 10–15 nice reels today pls 💃🏻`);
    }
    if (queueFull || !queueEmpty) {
      lines.push(
        `${at(cfg.va_username)}, ${x.toEdit} ${x.toEdit === 1 ? "job is" : "jobs are"} waiting for a cut — please catch up with editing 💯`
      );
    }
  }

  if (x.openLinks < cfg.min_open_links) {
    lines.push(
      `${lines.length ? "\n" : ""}🔗 Inspo is running low too — ${x.openLinks} open ${x.openLinks === 1 ? "idea" : "ideas"} left. ${at(cfg.manager_username)}, keep the links coming 🙏`
    );
  }

  if (x.shotNotUploaded >= 3) {
    lines.push(
      `${lines.length ? "\n" : ""}📤 ${at(cfg.model_username)}, ${x.shotNotUploaded} reels are marked as shot but not uploaded yet — whenever you get a minute 🙌`
    );
  }

  return lines.length > 0 ? lines.join("\n").trim() : null;
}
