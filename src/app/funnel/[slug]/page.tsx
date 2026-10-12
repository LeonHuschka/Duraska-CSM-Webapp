import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPage, logEvent, pictureUrl, readVisitor } from "@/lib/funnel";
import { totalFollowers } from "@/lib/funnel-dashboard";
import { gateCopy, gateLang } from "@/lib/funnel-i18n";
import { FunnelShell } from "./shell";
import { GateClient } from "./gate-client";
import { FunnelClient } from "./funnel-client";

/**
 * Page 1: the gate. This is the address in the Instagram bio, and the page
 * Meta's crawler and Instagram's in-app browser get: the cover, the name,
 * the line, and one button that leads to the real page in the real
 * browser. Nothing about the destination is on it. A visitor who is
 * already in a real browser is shown the real page straight away.
 */
export const dynamic = "force-dynamic";

export default async function GatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug === "_" ? null : slug);
  if (!page) notFound();

  const req = new Request(`https://${host}/${slug}`, { headers: h });
  const visitor = readVisitor(req);
  const lang = gateLang(h.get("accept-language"));
  const base = `/api/funnel/${page.id}`;
  const realBrowser = !visitor.inApp && !visitor.bot;

  const [followers] = await Promise.all([
    page.show_followers
      ? totalFollowers(createAdminClient(), page.persona_id)
      : Promise.resolve(null),
    logEvent(page, visitor, "view", realBrowser ? "open" : "gate"),
  ]);

  return (
    <FunnelShell
      page={page}
      base={base}
      followers={followers}
      lang={lang}
      cover="cover"
    >
      {realBrowser ? (
        <FunnelClient
          base={base}
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
          openUrl={`https://${host}/${page.slug}/open`}
        />
      ) : (
        <GateClient
          openUrl={`https://${host}/${page.slug}/open`}
          copy={gateCopy(h.get("accept-language"))}
          breakout={page.breakout}
        />
      )}
    </FunnelShell>
  );
}
