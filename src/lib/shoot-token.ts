import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { APP_URL } from "@/lib/trials";

/**
 * The upload page of one inspo link opens from a Telegram button, in
 * Telegram's own browser, where nobody is signed in. Its address is its
 * key: the link's id and a signature only the server can make, so the
 * page reaches that one link and nothing else.
 */
function sign(linkId: string): string | null {
  const secret = process.env.CRON_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(`shoot:${linkId}`).digest("base64url").slice(0, 22);
}

export function shootUrl(linkId: string): string | null {
  const sig = sign(linkId);
  return sig ? `${APP_URL}/shoot/${linkId}.${sig}` : null;
}

/** The link id the token is for, or null when it was not made here. */
export function readShootToken(token: string): string | null {
  const [linkId, sig] = decodeURIComponent(token).split(".");
  if (!linkId || !sig || !/^[0-9a-f-]{36}$/.test(linkId)) return null;
  const want = sign(linkId);
  if (!want || want.length !== sig.length) return null;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? linkId : null;
}
