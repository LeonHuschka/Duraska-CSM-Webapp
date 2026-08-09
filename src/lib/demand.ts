import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export type Demand = {
  /** Reels that have to go out every day across all live accounts. */
  perDay: number;
  /** How many accounts that is spread over. */
  accounts: number;
};

/**
 * How much content the accounts actually consume per day.
 *
 * Not "live accounts × a persona-wide rate": accounts post at different
 * rates, and one warming up posts nothing at all. Summing the real rates is
 * the only figure the weekly goal, the days of stock and the Telegram
 * runway can be built on without being wrong in the same direction every
 * time.
 */
export async function dailyDemand(
  supabase: SupabaseClient<Database>,
  personaId: string
): Promise<Demand> {
  const { data } = await supabase
    .from("accounts")
    .select("posts_per_day")
    .eq("persona_id", personaId)
    .not("status", "in", '("dead","paused")');

  const rows = data ?? [];
  return {
    perDay: rows.reduce((sum, a) => sum + Number(a.posts_per_day ?? 0), 0),
    accounts: rows.length,
  };
}
