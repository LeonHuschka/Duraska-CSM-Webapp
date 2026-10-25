import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { findPage, logEvent, readVisitor } from "@/lib/funnel";
import { pictureUrl } from "@/lib/funnel-pictures";
import { gateCopy, gateLang } from "@/lib/funnel-i18n";
import { FunnelShell } from "./shell";
import { GateClient } from "./gate-client";

/**
 * Page 1: the gate. This is the address in the Instagram bio, and the one
 * page everyone gets — Meta's crawler, a reviewer typing it into a
 * desktop browser, the in-app browser, a fan: the cover, the name, the
 * line, and one button. The HTML is the same whoever asks; nothing in it
 * leads anywhere. The real page's address exists only at runtime, handed
 * out by the key endpoint to visitors it takes for people.
 */
export const dynamic = "force-dynamic";

export default async function GatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug === "_" ? null : slug);
  if (!page) notFound();

  const req = new Request(`https://${host}/${slug}`, { headers: h });
  const visitor = readVisitor(req);
  const lang = gateLang(h.get("accept-language"));
  const base = `/api/funnel/${page.id}`;

  const [followers] = await Promise.all([
    Promise.resolve(null),
    logEvent(page, visitor, "view", "gate"),
  ]);

  return (
    <FunnelShell
      page={page}
      base={base}
      followers={followers}
      lang={lang}
      coverSrc={page.cover_path ? pictureUrl(base, "cover", page.cover_path) : null}
      link={page.link}
      stat="visitors"
      telegram={page.telegram_url ? { base, slug: page.link } : null}
    >
      <GateClient base={base} slug={page.link} copy={gateCopy(h.get("accept-language"))} breakout={page.breakout} />
    </FunnelShell>
  );
}
