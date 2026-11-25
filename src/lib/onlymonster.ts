import "server-only";

/**
 * OnlyFans numbers through OnlyMonster, read only. The key lives in the
 * server variable ONLYMONSTER_API_KEY; without it every call returns null
 * and the dashboard says OnlyFans is not connected.
 *
 * The API has no daily series and no total fan count. New fans per day
 * come from one list of subscriptions, counted by day; money and spenders
 * from a handful of period calls. Few calls on purpose: the API answers
 * 429 well before its stated limit when a page asks for every day apart.
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
};

type Sub = { action: string; subscribed_at: string };

const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString());

/**
 * New fans per UTC day, oldest first, from the subscription list: a
 * "subscribe" is a fan new to the page; prolongs and returns are not.
 * Null when the API did not answer, so a gap is never drawn as zero.
 */
export async function ofDaily(accountId: string, days: number): Promise<OfDay[] | null> {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const start = today - (days - 1) * DAY;
  const count = new Map<number, number>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const got = await om<{ items: Sub[]; cursor?: string }>(
      `/api/v0/platforms/onlyfans/accounts/${encodeURIComponent(accountId)}/subscriptions?start=${iso(start)}&end=${iso(
        today + DAY - 1
      )}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      900
    );
    if (!got) return null;
    for (const s of got.items) {
      if (s.action !== "subscribe") continue;
      const d = Math.floor(Date.parse(s.subscribed_at) / DAY) * DAY;
      count.set(d, (count.get(d) ?? 0) + 1);
    }
    cursor = got.cursor;
    if (!cursor) break;
  }
  return Array.from({ length: days }, (_, i) => {
    const day = start + i * DAY;
    return { day, newFans: count.get(day) ?? 0 };
  });
}

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
    `/api/v0/platforms/onlyfans/accounts/${encodeURIComponent(id)}/overview-metrics?from=${iso(from)}&to=${iso(
      to
    )}&include_subscription_revenue=true&earnings_type=net`,
    revalidate
  );

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
