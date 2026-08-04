import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Service-role client for server-side jobs that run without a logged-in
 * user (Telegram webhook, cron). Bypasses RLS — never import this into
 * anything that renders for a user.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
