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
    // Next.js caches fetch() responses in route handlers, and Vercel keeps
    // that cache across deployments. A row read here once came back stale
    // for hours — the landing page's cover never appeared. Nothing this
    // client reads may be served from a cache.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
