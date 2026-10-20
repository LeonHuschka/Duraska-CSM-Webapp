import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePersonaId } from "@/lib/persona";
import { probeInstagramPosts, probeInstagramReels, scrapeAccounts } from "@/lib/account-scrape";
import { storeCovers } from "@/lib/stored-images";
import { announceWinners } from "@/lib/winners";

/**
 * Read every posting account now, as the person who is logged in.
 *
 * The same job the 7:17 cron runs and the "Scrape now" button starts, on a
 * URL: open it in a browser that is signed in as an owner or manager and
 * it runs. Useful when the button is out of reach — a phone, a bookmark,
 * an automation that can hold a session but not click.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const personaId = await getActivePersonaId();
  if (!personaId) return NextResponse.json({ error: "no persona" }, { status: 400 });

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase
      .from("persona_members")
      .select("role")
      .eq("persona_id", personaId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const allowed =
    profile?.global_role === "owner" ||
    membership?.role === "owner" ||
    membership?.role === "manager";
  if (!allowed) return NextResponse.json({ error: "owners and managers only" }, { status: 403 });

  // ?full=1 reads every reel an account has, for the first read of a new
  // account or to backfill the list; the daily run takes the newest only.
  const params = new URL(req.url).searchParams;
  const admin = createAdminClient();
  // ?winners=all reports every reel that ever qualified, oldest first, and
  // scrapes nothing — the one-time catch-up for the months before winners
  // were watched daily.
  const mode = params.get("winners");
  if (mode === "all" || mode?.startsWith("redo-")) {
    const winners = await announceWinners(admin, personaId, {
      includeOld: true,
      redoPlatform: mode.startsWith("redo-") ? mode.slice(5) : undefined,
    });
    return NextResponse.json({ ok: true, winners });
  }
  const t0 = Date.now();
  // ?probe=<username> shows the first reels of one Instagram account as the
  // Reels-tab actor returns them — to check which field holds the plays.
  // ?probePosts=CODE,CODE asks the by-URL actor about single reels.
  const probePosts = params.get("probePosts");
  if (probePosts) {
    const codes = probePosts.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 6);
    return NextResponse.json({ ok: true, probe: await probeInstagramPosts(codes) });
  }
  const probe = params.get("probe");
  if (probe) return NextResponse.json({ ok: true, probe: await probeInstagramReels(probe, 3) });
  // ?covers=1 copies covers into storage from the latest readings and
  // scrapes nothing — to finish what a run left for later.
  if (params.get("covers") === "1") {
    const covers = await storeCovers(admin, personaId, t0 + 250_000);
    return NextResponse.json({ ok: true, covers });
  }
  // ?account=<id> reads one account, every reel it has up to a limit —
  // what the tab asks for the moment an account is added.
  const one = params.get("account");
  if (one) {
    // &codes=A,B reads these reels by URL too — the ones Instagram keeps
    // from logged-out readers and no list returns.
    const codes = (params.get("codes") ?? "").split(",").map((c) => c.trim()).filter((c) => /^[A-Za-z0-9_-]{5,}$/.test(c));
    const summary = await scrapeAccounts(admin, personaId, {
      accountIds: [one],
      extraCodes: codes.length ? { [one]: codes } : undefined,
      igPerAccount: 40,
      fbPerPage: 30,
      deadline: t0 + 250_000,
    });
    return NextResponse.json({ ok: true, summary });
  }
  const full = params.get("full") === "1";
  // ?ig=40 reads that many reels per Instagram account and Facebook as
  // usual — to bring every Instagram reel up to date without paying for a
  // full read of the Facebook feeds.
  const ig = Number(params.get("ig"));
  const summary = await scrapeAccounts(admin, personaId, {
    full,
    deadline: t0 + 250_000,
    igPerAccount: Number.isFinite(ig) && ig > 0 ? Math.min(100, Math.round(ig)) : undefined,
  });
  const winners = await announceWinners(admin, personaId);
  return NextResponse.json({ ok: true, summary, winners });
}
