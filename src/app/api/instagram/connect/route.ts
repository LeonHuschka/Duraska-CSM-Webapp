import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { plannerAccount } from "@/lib/planner-access";
import { authorizeUrl, igConfigured } from "@/lib/instagram-api";

export const dynamic = "force-dynamic";

/**
 * Off to Instagram to connect an account. The state carries a one-time
 * nonce, also kept in a cookie, so the callback knows the answer is ours.
 *
 *   GET /api/instagram/connect?account=<account id>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account") ?? "";
  const access = await plannerAccount(accountId);
  if (!access) return NextResponse.redirect(new URL("/?tab=accounts", url));
  if (!igConfigured()) {
    return NextResponse.redirect(new URL(`/planner/${accountId}?ig_error=${encodeURIComponent("The Instagram app is not set up yet")}`, url));
  }
  const nonce = crypto.randomUUID();
  (await cookies()).set("ig_oauth", `${nonce}.${accountId}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/instagram",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(nonce));
}
