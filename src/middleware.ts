import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** The hosts the app itself answers on. Anything else is a funnel domain. */
const APP_HOSTS = new Set(
  [
    "localhost:3000",
    "localhost",
    "127.0.0.1:3000",
    process.env.NEXT_PUBLIC_APP_HOST,
    process.env.VERCEL_URL,
  ].filter(Boolean) as string[]
);

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  // A persona's own domain (sarahprice.link) is served by the app too, but
  // it shows the public landing page and nothing else — no session, no
  // login redirect. The page resolves itself by host; the path is the slug.
  const isApp =
    APP_HOSTS.has(host) || host.endsWith(".vercel.app") || host === "csm-duraskastudios.space";
  if (!isApp) {
    if (pathname.startsWith("/api/funnel") || pathname.startsWith("/funnel/")) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    const slug = pathname.replace(/^\/+|\/+$/g, "");
    url.pathname = `/funnel/${slug || "_"}`;
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/api/funnel") || pathname.startsWith("/funnel/")) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Machine endpoints must NOT go through the session middleware: Telegram,
    // Vercel Cron and the webhook's own follow-up calls have no Supabase
    // session, so they get redirected to /login (307) and fail silently.
    // That is not hypothetical — /api/links/check was added outside this list
    // and every run of it died as a 307 nobody saw. Each of these routes
    // authenticates itself: the webhook by Telegram's secret-token header,
    // the crons by x-vercel-cron or CRON_SECRET, the link check by
    // CRON_SECRET. Anything new under /api that a machine calls belongs here.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/telegram|api/cron|api/links|api/cover|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
