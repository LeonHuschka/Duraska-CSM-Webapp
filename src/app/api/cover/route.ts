import { NextResponse } from "next/server";

/**
 * Fetch a post's cover image on the browser's behalf.
 *
 * The scrapers hand back cover URLs on Meta's CDNs, and those refuse the
 * browser more often than not — no referrer, wrong referrer, a signature
 * bound to something the page cannot send. The tile then shows a broken
 * image. Fetched from here the same URL answers, so the page asks here.
 *
 * Only Meta's image hosts are fetched; this is not an open proxy.
 */
export const dynamic = "force-dynamic";

const ALLOWED = [
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)fbsbx\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)facebook\.com$/i,
];

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u");
  if (!raw) return new NextResponse("missing u", { status: 400 });
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.some((re) => re.test(target.hostname))) {
    return new NextResponse("host not allowed", { status: 403 });
  }

  const upstream = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!upstream || !upstream.ok) {
    return new NextResponse("upstream failed", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!type.startsWith("image/")) return new NextResponse("not an image", { status: 502 });

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": type,
      // A cover does not change; the URL it came from expires and is
      // replaced by the next scrape, so a day is plenty.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
