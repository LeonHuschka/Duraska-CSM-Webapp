import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|api/links|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
