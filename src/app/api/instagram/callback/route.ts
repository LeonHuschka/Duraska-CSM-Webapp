import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { plannerAccount } from "@/lib/planner-access";
import { connectWithCode } from "@/lib/instagram-api";

export const dynamic = "force-dynamic";

/** Instagram sends the account back here; the token is kept for publishing. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const [nonce, accountId] = (jar.get("ig_oauth")?.value ?? "").split(".");
  jar.delete({ name: "ig_oauth", path: "/api/instagram" });
  const back = (q: string) => NextResponse.redirect(new URL(`/planner/${accountId}?${q}`, url));
  if (!nonce || !accountId) return NextResponse.redirect(new URL("/?tab=accounts", url));
  if (url.searchParams.get("state") !== nonce) return back(`ig_error=${encodeURIComponent("The answer from Instagram did not match — try again")}`);
  const code = url.searchParams.get("code");
  if (!code) return back(`ig_error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Instagram said no")}`);

  const access = await plannerAccount(accountId);
  if (!access) return NextResponse.redirect(new URL("/?tab=accounts", url));
  try {
    // Instagram appends "#_" to the code in some answers.
    const conn = await connectWithCode(code.replace(/#_$/, ""));
    const { error } = await createAdminClient()
      .from("ig_connections")
      .upsert({
        account_id: accountId,
        persona_id: access.account.persona_id,
        ig_user_id: conn.igUserId,
        username: conn.username,
        access_token: conn.token,
        token_expires_at: conn.expiresAt,
        connected_by: access.userId,
        connected_at: new Date().toISOString(),
        refreshed_at: null,
      });
    if (error) return back(`ig_error=${encodeURIComponent(error.message)}`);
    return back("connected=1");
  } catch (err) {
    return back(`ig_error=${encodeURIComponent(err instanceof Error ? err.message : "Could not connect")}`);
  }
}
