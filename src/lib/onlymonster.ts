import "server-only";

/**
 * OnlyFans numbers through OnlyMonster, read only. The key lives in the
 * server variable ONLYMONSTER_API_KEY; without it every call returns null
 * and the dashboard says OnlyFans is not connected.
 *
 * The API has no daily series and no total fan count. A day is one call to
 * overview-metrics with that UTC day as the period; a past day never
 * changes, so its answer is kept a day, today's a quarter of an hour.
 */
const BASE = "https://omapi.onlymonster.ai";
const DAY = 86_400_000;

export const omConfigured = () => !!process.env.ONLYMONSTER_API_KEY;

async function om<T>(path: string, revalidate: number): Promise<T | null> {
  const key = process.env.ONLYMONSTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-om-auth-token": key, accept: "application/json" },
      next: { revalidate },
    });
    if (!res.ok) {
      console.error(`[onlymonster] ${res.status} ${path.split("?")[0]}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error("[onlymonster]", (e as Error).message);
    return null;
  }
}

type OmAccount = { id: number; platform: string; platform_account_id: string; username: string; name: string };

/** The OnlyFans account behind the page: matched on the username in its address, else the only one there is. */
export async function onlyFansAccount(username: string | null): Promise<OmAccount | null> {
  const got = await om<{ accounts: OmAccount[] }>("/api/v0/accounts?limit=100", 6 * 3600);
  const of = (got?.accounts ?? []).filter((a) => a.platform === "onlyfans");
  const u = username?.toLowerCase();
  return of.find((a) => a.username?.toLowerCase() === u) ?? (of.length === 1 ? of[0] : null);
}

export type OfDay = {
  /** UTC day start, ms. */
  day: number;
  newFans: number;
  revenue: number;
  spenders: number;
  newSpenders: number;
};

type Overview = {
  new_fans_count: number;
  fans_count: number;
  total_revenue: number;
  spenders_count: number;
  new_spenders_count: number;
  new_fan_to_spender_conversion_percent: number | null;
};

const overview = (id: string, from: number, to: number, revalidate: number) =>
  om<Overview>(
    `/api/v0/platforms/onlyfans/accounts/${encodeURIComponent(id)}/overview-metrics?from=${encodeURIComponent(
      new Date(from).toISOString()
    )}&to=${encodeURIComponent(new Date(to).toISOString())}&include_subscription_revenue=true&earnings_type=net`,
    revalidate
  );

/** One point per UTC day, oldest first; days the API did not answer are left out. */
export async function ofDaily(accountId: string, days: number): Promise<OfDay[]> {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const starts = Array.from({ length: days }, (_, i) => today - (days - 1 - i) * DAY);
  const out: OfDay[] = [];
  // Ten at a time: the endpoint allows fifteen a second.
  for (let i = 0; i < starts.length; i += 10) {
    const batch = starts.slice(i, i + 10);
    const got = await Promise.all(
      batch.map((d) => overview(accountId, d, d + DAY - 1, d === today ? 900 : 86_400))
    );
    got.forEach((o, j) => {
      if (!o) return;
      out.push({
        day: batch[j],
        newFans: o.new_fans_count ?? 0,
        revenue: o.total_revenue ?? 0,
        spenders: o.spenders_count ?? 0,
        newSpenders: o.new_spenders_count ?? 0,
      });
    });
  }
  return out;
}

export type OfPeriod = {
  newFans: number;
  /** Fans with any subscription event in the period — the nearest the API has to a total. */
  fans: number;
  revenue: number;
  spenders: number;
  newSpenders: number;
  fanToSpender: number | null;
};

/** Figures for a stretch of time, in one call. */
export async function ofPeriod(accountId: string, from: number, to: number): Promise<OfPeriod | null> {
  const o = await overview(accountId, from, to, 900);
  if (!o) return null;
  return {
    newFans: o.new_fans_count ?? 0,
    fans: o.fans_count ?? 0,
    revenue: o.total_revenue ?? 0,
    spenders: o.spenders_count ?? 0,
    newSpenders: o.new_spenders_count ?? 0,
    fanToSpender: o.new_fan_to_spender_conversion_percent ?? null,
  };
}
