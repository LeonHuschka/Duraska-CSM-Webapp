import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkKey, checkPass, findPage, logEvent, readCookie, readVisitor } from "@/lib/funnel";
import { pictureUrl } from "@/lib/funnel-pictures";
import { gateCopy, gateLang } from "@/lib/funnel-i18n";
import { FunnelShell } from "../shell";
import { FunnelClient } from "../funnel-client";
import { GateClient } from "../gate-client";

/**
 * Page 2: the real page, the one the gate opens in Safari or Chrome. The
 * same head, and under it the picture card that is the button.
 *
 * It opens only with a key in the address — the one the gate fetched for
 * this visitor's network address minutes ago — or with the pass the card's
 * config set as a cookie on an earlier visit. Without either, or for
 * anything that looks like a crawler, this address shows exactly what
 * page 1 shows: the gate. So the address alone, typed in or fetched from a
 * log, gives nothing away. The card's link is fetched after load and only
 * ever points at this site; the destination never leaves the server.
 */
export const dynamic = "force-dynamic";

export default async function OpenPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { slug } = await params;
  const { k = null } = await searchParams;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug);
  if (!page) notFound();

  const req = new Request(`https://${host}/${slug}/open`, { headers: h });
  const visitor = readVisitor(req);
  const base = `/api/funnel/${page.id}`;
  const lang = gateLang(h.get("accept-language"));
  const admitted = !visitor.bot && (checkKey(req, k) || checkPass(req, page.id, readCookie(h.get("cookie"), "fp")));

  const [followers] = await Promise.all([
    Promise.resolve(null),
    logEvent(page, visitor, "view", admitted ? "open" : "open-refused"),
  ]);

  if (!admitted) {
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

  return (
    <FunnelShell
      page={page}
      base={base}
      followers={followers}
      lang={lang}
      coverSrc={
        page.open_cover_path
          ? pictureUrl(base, "open-cover", page.open_cover_path)
          : page.cover_path
            ? pictureUrl(base, "cover", page.cover_path)
            : null
      }
      link={page.link}
      stat={null}
      showBio={false}
      telegram={page.telegram_url ? { href: page.telegram_url } : null}
      fit
    >
      <FunnelClient
        base={base}
        slug={page.link}
        k={k}
        label={page.button_label}
        status={page.status_text}
        image={
          page.button_image_path
            ? pictureUrl(base, "button", page.button_image_path)
            : page.cover_path
              ? pictureUrl(base, "cover", page.cover_path)
              : null
        }
        ageGate={page.age_gate}
        breakout={page.breakout}
        openUrl={`https://${host}/${page.link}/open${k ? `?k=${encodeURIComponent(k)}` : ""}`}
        telegramUrl={page.telegram_url}
        telegramLabel={page.telegram_label}
        fit
      />
    </FunnelShell>
  );
}
