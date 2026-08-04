import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Machine endpoints must NOT go through the session middleware: Telegram
    // and Vercel Cron have no Supabase session, so they'd be redirected to
    // /login (307) and the webhook would silently never fire. Both routes
    // authenticate themselves — the webhook via Telegram's secret-token
    // header, the crons via the x-vercel-cron header or CRON_SECRET.
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
