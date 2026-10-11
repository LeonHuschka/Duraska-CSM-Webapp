import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockedByCountry, logEvent, readVisitor, tripped } from "@/lib/funnel";

/**
 * The landing page's back end, one route with four jobs:
 *
 *   config   the button's address — this site's own /go, never the target
 *   go       the redirect, after the visitor has been checked
 *   c        the canary: whoever lands here is a crawler, remembered a day
 *   cover    the cover picture, streamed from private storage
 *   button   the picture on the button card, the same way
 *
 * No session, no cookies. Everything a visitor sends is hashed before it
 * is stored; the destination is read from the row at the moment of the
 * redirect and in no other place.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const supabase = createAdminClient();
  const { data: page } = await supabase.from("funnel_pages").select("*").eq("id", id).maybeSingle();
  if (!page || !page.enabled) return new NextResponse("not found", { status: 404 });
  const v = readVisitor(req);

  switch (action) {
    case "config": {
      // A crawler asking for the config gets an empty answer: no button.
      if (v.bot || (await tripped(page, v))) {
        return NextResponse.json({ href: null }, { headers: { "cache-control": "no-store" } });
      }
      return NextResponse.json({ href: `/api/funnel/${page.id}/go` }, { headers: { "cache-control": "no-store" } });
    }

    case "go": {
      if (!page.destination_url) return new NextResponse("not set up yet", { status: 404 });
      if (v.bot) {
        await logEvent(page, v, "blocked", v.bot);
        // The same page, so a bot following the link learns nothing.
        return NextResponse.redirect(new URL(`/${page.slug}`, req.url), 302);
      }
      if (await tripped(page, v)) {
        await logEvent(page, v, "blocked", "tripped the canary");
        return NextResponse.redirect(new URL(`/${page.slug}`, req.url), 302);
      }
      if (blockedByCountry(page, v)) {
        await logEvent(page, v, "blocked", `country ${v.country}`);
        return new NextResponse("not available in your region", { status: 451 });
      }
      await logEvent(page, v, "click");
      return NextResponse.redirect(page.destination_url, {
        status: 302,
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      });
    }

    case "c": {
      await logEvent(page, v, "canary", "followed the hidden link");
      return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
    }

    case "cover":
    case "button": {
      const path = action === "cover" ? page.cover_path : page.button_image_path;
      if (!path) return new NextResponse("no picture", { status: 404 });
      const { data: blob } = await supabase.storage.from("content-assets").download(path);
      if (!blob) return new NextResponse("no cover", { status: 404 });
      return new NextResponse(blob.stream(), {
        headers: {
          "content-type": blob.type || "image/jpeg",
          "cache-control": "public, max-age=3600, s-maxage=86400",
        },
      });
    }

    case "report":
    case "privacy": {
      const text =
        action === "report"
          ? "To report this page, email the address in the domain's WHOIS record. Reports are read within a day."
          : "This page stores no cookies and no personal data. Visits are counted with a one-way hash that cannot be turned back into an address.";
      return new NextResponse(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    case "debug": {
      // Which columns the row arrives with — for when a picture will not show.
      return NextResponse.json({ keys: Object.keys(page), cover: !!page.cover_path, button: !!page.button_image_path, updated: page.updated_at });
    }

    default:
      return new NextResponse("not found", { status: 404 });
  }
}
