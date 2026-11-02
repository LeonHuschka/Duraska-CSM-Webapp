import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plannerAccount } from "@/lib/planner-access";
import { accountLabel } from "@/lib/account-analytics";
import { PlannerView, type PlannerCut, type PlannerPost } from "@/components/planner/planner-view";

// "Post now" publishes inside the server action and waits for Instagram.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The auto-post planner of one Instagram account: the vault's cuts on the
 * left, a calendar on the right, a cut dragged onto a day is a post that
 * goes out by itself at its time.
 */
export default async function PlannerPage({
  params,
}: {
  params: { accountId: string };
}) {
  const access = await plannerAccount(params.accountId);
  if (!access) notFound();
  const { account } = access;
  const supabase = await createClient();
  const admin = createAdminClient();

  const SLOT_BASE = "id, asset_id, request_id, account_id, scheduled_for, status, caption, post_url, posted_at";
  const SLOT_AUTO = `${SLOT_BASE}, auto_publish, trial_reel, share_to_feed, publish_state, publish_error`;

  const [{ data: requests }, { data: accounts }, autoSlots, { data: conn }] = await Promise.all([
    supabase
      .from("content_requests")
      .select("id, title, is_nsfw")
      .eq("persona_id", account.persona_id)
      .eq("is_nsfw", false)
      .limit(5000),
    supabase.from("accounts").select("id, handle").eq("persona_id", account.persona_id),
    supabase.from("schedule_slots").select(SLOT_AUTO).eq("persona_id", account.persona_id).limit(5000),
    admin
      .from("ig_connections")
      .select("username, token_expires_at, connected_at")
      .eq("account_id", account.id)
      .maybeSingle(),
  ]);
  // Before migration 00062 the auto-post columns are not there yet.
  const migrated = !autoSlots.error;
  type SlotRow = {
    id: string;
    asset_id: string | null;
    request_id: string | null;
    account_id: string | null;
    scheduled_for: string;
    status: string;
    caption: string | null;
    post_url: string | null;
    posted_at: string | null;
    auto_publish?: boolean;
    trial_reel?: boolean;
    share_to_feed?: boolean;
    publish_state?: string | null;
    publish_error?: string | null;
  };
  const slots: SlotRow[] = migrated
    ? ((autoSlots.data ?? []) as SlotRow[])
    : (((await supabase.from("schedule_slots").select(SLOT_BASE).eq("persona_id", account.persona_id).limit(5000)).data ??
        []) as SlotRow[]);

  const titleOf = new Map((requests ?? []).map((r) => [r.id, r.title]));
  const labelOf = new Map((accounts ?? []).map((a) => [a.id, accountLabel(a.handle)]));

  // The finished Instagram cuts, newest first.
  const requestIds = Array.from(titleOf.keys());
  const { data: assets } = requestIds.length
    ? await supabase
        .from("content_assets")
        .select("id, request_id, file_path, thumbnail_path, uploaded_at")
        .in("request_id", requestIds)
        .eq("stage", "edited")
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false })
        .limit(600)
    : { data: [] as { id: string; request_id: string; file_path: string; thumbnail_path: string | null; uploaded_at: string }[] };

  // Every cut a post on this account points at must be signed too, even
  // when it is older than the newest 600.
  const known = new Set((assets ?? []).map((a) => a.id));
  const missing = Array.from(
    new Set(slots.filter((s) => s.account_id === account.id && s.asset_id && !known.has(s.asset_id)).map((s) => s.asset_id!))
  );
  const { data: extra } = missing.length
    ? await supabase
        .from("content_assets")
        .select("id, request_id, file_path, thumbnail_path, uploaded_at")
        .in("id", missing)
    : { data: [] as NonNullable<typeof assets> };
  const all = [...(assets ?? []), ...(extra ?? [])];

  const paths = new Set<string>();
  for (const a of all) {
    paths.add(a.file_path);
    if (a.thumbnail_path) paths.add(a.thumbnail_path);
  }
  const signed = new Map<string, string>();
  const list = Array.from(paths);
  for (let i = 0; i < list.length; i += 500) {
    const { data } = await supabase.storage.from("content-assets").createSignedUrls(list.slice(i, i + 500), 6 * 3600);
    for (const u of data ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  // Cut n of m, in upload order, per reel.
  const order = new Map<string, string[]>();
  for (const a of [...all].sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))) {
    if (!order.has(a.request_id)) order.set(a.request_id, []);
    order.get(a.request_id)!.push(a.id);
  }

  // Where each cut went or is going.
  const usedOn = new Map<string, Set<string>>();
  const queued = new Set<string>();
  for (const s of slots) {
    if (!s.asset_id) continue;
    if (s.status === "posted") {
      if (!usedOn.has(s.asset_id)) usedOn.set(s.asset_id, new Set());
      usedOn.get(s.asset_id)!.add(s.account_id ? labelOf.get(s.account_id) ?? "an account" : "somewhere");
    } else if (s.auto_publish && s.publish_state !== "failed") {
      queued.add(s.asset_id);
    }
  }

  const assetOf = new Map(all.map((a) => [a.id, a]));
  const variant = (a: { id: string; request_id: string }) => {
    const ids = order.get(a.request_id) ?? [];
    return ids.length > 1 ? `${ids.indexOf(a.id) + 1}/${ids.length}` : null;
  };

  const cuts: PlannerCut[] = (assets ?? [])
    .filter((a) => signed.has(a.file_path))
    .map((a) => ({
      id: a.id,
      requestId: a.request_id,
      title: titleOf.get(a.request_id) ?? "Reel",
      variant: variant(a),
      thumb: a.thumbnail_path ? signed.get(a.thumbnail_path) ?? null : null,
      video: signed.get(a.file_path)!,
      uploadedAt: a.uploaded_at,
      usedOn: Array.from(usedOn.get(a.id) ?? []),
      queued: queued.has(a.id),
    }));

  const since = Date.now() - 62 * 86_400_000;
  const posts: PlannerPost[] = slots
    .filter((s) => s.account_id === account.id)
    .filter((s) => s.auto_publish || s.status === "posted")
    .filter((s) => new Date(s.posted_at ?? s.scheduled_for).getTime() >= since)
    .map((s) => {
      const a = s.asset_id ? assetOf.get(s.asset_id) : undefined;
      return {
        id: s.id,
        assetId: s.asset_id,
        title: (s.request_id && titleOf.get(s.request_id)) || "Reel",
        variant: a ? variant(a) : null,
        thumb: a?.thumbnail_path ? signed.get(a.thumbnail_path) ?? null : null,
        video: a ? signed.get(a.file_path) ?? null : null,
        at: s.status === "posted" ? s.posted_at ?? s.scheduled_for : s.scheduled_for,
        caption: s.caption ?? "",
        trialReel: !!s.trial_reel,
        shareToFeed: s.share_to_feed ?? true,
        status: s.status,
        publishState: s.publish_state ?? null,
        publishError: s.publish_error ?? null,
        postUrl: s.post_url,
        auto: !!s.auto_publish,
      };
    });

  const avatar = account.avatar_path
    ? (await supabase.storage.from("content-assets").createSignedUrl(account.avatar_path, 3600)).data?.signedUrl ?? null
    : null;

  return (
    <PlannerView
      account={{
        id: account.id,
        label: accountLabel(account.handle),
        platform: account.platform,
        avatar,
        perDay: Number(account.posts_per_day ?? 0),
        hasTopic: account.telegram_chat_id != null,
      }}
      connection={conn ? { username: conn.username, expiresAt: conn.token_expires_at } : null}
      migrated={migrated}
      cuts={cuts}
      posts={posts}
    />
  );
}
