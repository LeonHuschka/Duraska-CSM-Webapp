import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  blockedByCountry,
  checkKey,
  checkPass,
  checkTicket,
  issueKey,
  issuePass,
  issueTicket,
  logEvent,
  readCookie,
  readVisitor,
  tripped,
} from "@/lib/funnel";

/**
 * The landing page's back end, one route with these jobs:
 *
 *   key      the real page's address, with a key bound to the visitor's
 *            network address — handed out by the gate's script, and only
 *            to what looks like a person; a crawler gets nothing (204)
 *   config   the button's address — this site's own /go with a ticket
 *            bound to the visitor's address; never the target. Takes the
 *            key or the pass, and sets the pass as a cookie
 *   go       the redirect, after the visitor and the ticket have been checked
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

  const noStore = { "cache-control": "no-store" };

  switch (action) {
    case "key": {
      // Nothing for a crawler — not even an empty answer worth reading.
      if (v.bot || (await tripped(page, v))) {
        await logEvent(page, v, "blocked", `key: ${v.bot ?? "tripped the canary"}`);
        return new NextResponse(null, { status: 204, headers: noStore });
      }
      return NextResponse.json(
        { u: `https://${page.domain}/${page.slug}/open?k=${issueKey(req)}` },
        { headers: noStore }
      );
    }

    case "config": {
      const k = new URL(req.url).searchParams.get("k");
      const pass = readCookie(req.headers.get("cookie"), "fp");
      // A crawler, or anyone without the key or the pass, gets no button.
      if (v.bot || (await tripped(page, v)) || !(checkKey(req, k) || checkPass(req, page.id, pass))) {
        return NextResponse.json({ href: null }, { headers: noStore });
      }
      const res = NextResponse.json({ href: `/api/funnel/${page.id}/go?t=${issueTicket(req)}` }, { headers: noStore });
      res.cookies.set("fp", issuePass(req, page.id), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 4 * 3600,
      });
      return res;
    }

    case "go": {
      if (!page.destination_url) return new NextResponse("not set up yet", { status: 404 });
      if (v.bot) {
        await logEvent(page, v, "blocked", v.bot);
        // The same page, so a bot following the link learns nothing.
        return NextResponse.redirect(new URL(`/${page.slug}`, req.url), 302);
      }
      if (!checkTicket(req, new URL(req.url).searchParams.get("t"))) {
        // A redirect address fetched from somewhere else, later, by
        // someone else. Nothing to see.
        await logEvent(page, v, "blocked", "no ticket for this address");
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
    case "open-cover":
    case "button": {
      const path =
        action === "cover" ? page.cover_path : action === "button" ? page.button_image_path : page.open_cover_path;
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

    default:
      return new NextResponse("not found", { status: 404 });
  }
}
