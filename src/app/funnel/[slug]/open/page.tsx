import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPage, logEvent, readVisitor } from "@/lib/funnel";
import { pictureUrl } from "@/lib/funnel-pictures";
import { totalFollowers } from "@/lib/funnel-dashboard";
import { gateLang } from "@/lib/funnel-i18n";
import { FunnelShell } from "../shell";
import { FunnelClient } from "../funnel-client";

/**
 * Page 2: the real page, the one the gate opens in Safari or Chrome. The
 * same head, and under it the picture card that is the button. The card's
 * address is fetched after load and only ever points at this site; the
 * destination never leaves the server.
 */
export const dynamic = "force-dynamic";

export default async function OpenPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug);
  if (!page) notFound();

  const req = new Request(`https://${host}/${slug}/open`, { headers: h });
  const visitor = readVisitor(req);
  const base = `/api/funnel/${page.id}`;
  const [followers] = await Promise.all([
    page.show_followers
      ? totalFollowers(createAdminClient(), page.persona_id)
      : Promise.resolve(null),
    logEvent(page, visitor, "view", "open"),
  ]);

  return (
    <FunnelShell
      page={page}
      base={base}
      followers={followers}
      lang={gateLang(h.get("accept-language"))}
      coverSrc={
        page.open_cover_path
          ? pictureUrl(base, "open-cover", page.open_cover_path)
          : page.cover_path
            ? pictureUrl(base, "cover", page.cover_path)
            : null
      }
    >
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
    </FunnelShell>
  );
}
