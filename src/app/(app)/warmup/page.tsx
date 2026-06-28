import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { WarmupView } from "@/components/warmup/warmup-view";
import { WARMUP_DURATION_DAYS } from "@/lib/warmup-spec";

export interface AccountSummary {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  status: string;
  warmup_started_at: string;
  currentDay: number;
  totalSlots: number;
  postedSlots: number;
  // slots due up to & including today that aren't posted/skipped yet
  dueToday: number;
  overdue: number;
}

export default async function WarmupPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">
          Select a persona to view warm-up accounts.
        </p>
      </div>
    );
  }

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, platform, handle, display_name, status, warmup_started_at")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false });

  const accountIds = (accounts ?? []).map((a) => a.id);

  // Pull all slots for these accounts in one query, aggregate client-side here.
  let slotsByAccount: Record<
    string,
    { day_number: number; status: string }[]
  > = {};
  if (accountIds.length > 0) {
    const { data: slots } = await supabase
      .from("warmup_slots")
      .select("account_id, day_number, status")
      .in("account_id", accountIds);
    slotsByAccount = {};
    for (const s of slots ?? []) {
      (slotsByAccount[s.account_id] ??= []).push({
        day_number: s.day_number,
        status: s.status,
      });
    }
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const now = Date.now();

  const summaries: AccountSummary[] = (accounts ?? []).map((a) => {
    const started = new Date(a.warmup_started_at).getTime();
    const currentDay = Math.min(
      WARMUP_DURATION_DAYS,
      Math.max(1, Math.floor((now - started) / MS_PER_DAY) + 1)
    );
    const slots = slotsByAccount[a.id] ?? [];
    const totalSlots = slots.length;
    const postedSlots = slots.filter((s) => s.status === "posted").length;
    // Slots scheduled for today or earlier that still need action
    const dueToday = slots.filter(
      (s) =>
        s.day_number === currentDay &&
        s.status !== "posted" &&
        s.status !== "skipped"
    ).length;
    const overdue = slots.filter(
      (s) =>
        s.day_number < currentDay &&
        s.status !== "posted" &&
        s.status !== "skipped"
    ).length;
    return {
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      display_name: a.display_name,
      status: a.status,
      warmup_started_at: a.warmup_started_at,
      currentDay,
      totalSlots,
      postedSlots,
      dueToday,
      overdue,
    };
  });

  return <WarmupView accounts={summaries} />;
}
