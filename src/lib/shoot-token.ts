import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { APP_URL } from "@/lib/trials";

/**
 * The upload page of one inspo link — or one Trial-Maxxing box — opens
 * from a Telegram button, in Telegram's own browser, where nobody is
 * signed in. Its address is its key: the id and a signature only the
 * server can make, so the page reaches that one thing and nothing else.
 *   /shoot/<linkId>.<sig>      an inspo link
 *   /shoot/c-<cellId>.<sig>    a trial box
 */
export type ShootTarget = { kind: "link" | "cell"; id: string };

function sign(t: ShootTarget): string | null {
  const secret = process.env.CRON_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return null;
  const what = t.kind === "link" ? `shoot:${t.id}` : `shoot:cell:${t.id}`;
  return createHmac("sha256", secret).update(what).digest("base64url").slice(0, 22);
}

export function shootUrl(id: string, kind: ShootTarget["kind"] = "link"): string | null {
  const sig = sign({ kind, id });
  return sig ? `${APP_URL}/shoot/${kind === "cell" ? "c-" : ""}${id}.${sig}` : null;
}

/** What the token is for, or null when it was not made here. */
export function readShootToken(token: string): ShootTarget | null {
  const [head, sig] = decodeURIComponent(token).split(".");
  if (!head || !sig) return null;
  const t: ShootTarget = head.startsWith("c-") ? { kind: "cell", id: head.slice(2) } : { kind: "link", id: head };
  if (!/^[0-9a-f-]{36}$/.test(t.id)) return null;
  const want = sign(t);
  if (!want || want.length !== sig.length) return null;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? t : null;
}
