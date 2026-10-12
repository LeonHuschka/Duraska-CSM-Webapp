import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { funnelDashboard, type Period } from "@/lib/funnel-dashboard";
import { WorldMap } from "./world-map";
import { countryName } from "@/lib/country-name";
import { DailyChart, HourlyChart } from "./charts";

const nf = new Intl.NumberFormat("de-DE");

/**
 * The link-in-bio page's dashboard: what the page did in the period, who
 * came, from where, and when — and what was turned away.
 */
export async function LinkTab({ personaId, days, canEdit }: { personaId: string; days: Period; canEdit: boolean }) {
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("funnel_pages")
    .select("id, domain, slug, display_name, destination_url, enabled, ignored_countries")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!page) {
    return (
      <div className="rounded-2xl border border-dashed border-border/50 bg-card/50 p-8 text-center text-sm text-muted-foreground">
        No link-in-bio page yet.{" "}
        {canEdit && (
          <Link href="/settings/funnel" className="text-primary underline">
            Set one up in Settings → Link in bio
          </Link>
        )}
      </div>
    );
  }

  const d = await funnelDashboard(supabase, page.id, days, page.ignored_countries ?? []);
  const url = `https://${page.domain}/${page.slug}`;
  const top = Object.entries(d.countries)
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 10);
  const totalViews = Math.max(1, d.views);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Link in bio</h2>
          <p className="text-[11px] text-muted-foreground">
            <a href={url} target="_blank" rel="noreferrer" className="font-mono text-primary">
              {url}
            </a>
            <span className="text-muted-foreground"> → </span>
            <a href={`${url}/open`} target="_blank" rel="noreferrer" className="font-mono text-primary">
              {url}/open
            </a>
            {!page.destination_url && <span className="ml-2 text-amber-400">· no destination set yet</span>}
            {!page.enabled && <span className="ml-2 text-rose-400">· page disabled</span>}
            {canEdit && (
              <>
                {" · "}
                <Link href="/settings/funnel" className="underline">
                  edit
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
          {([7, 30, 90] as Period[]).map((p) => (
            <Link
              key={p}
              href={`/?tab=link&days=${p}`}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                p === days ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p} days
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs against the period before */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Page views" value={nf.format(d.views)} delta={change(d.views, d.prev.views)} />
        <Kpi label="Made it to the real page" value={nf.format(d.opened)} delta={change(d.opened, d.prev.opened)} />
        <Kpi label="Link clicks" value={nf.format(d.clicks)} delta={change(d.clicks, d.prev.clicks)} />
        <Kpi label="Click rate" value={d.ctr == null ? "—" : `${(d.ctr * 100).toFixed(1)}%`} delta={change(d.ctr, d.prev.ctr)} />
        <Kpi
          label="From the Instagram app"
          value={d.views > 0 ? `${Math.round((d.inApp / d.views) * 100)}%` : "—"}
          hint={`${nf.format(d.inApp)} of the views`}
        />
      </div>

      {/* Map, the thing that matters most */}
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Where people come from</h3>
          <span className="text-[11px] text-muted-foreground">
            {Object.keys(d.countries).length} {Object.keys(d.countries).length === 1 ? "country" : "countries"} · people only, bots excluded
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[3fr_1fr]">
          <WorldMap countries={d.countries} />
          <ol className="space-y-1.5 text-xs">
            {top.map(([code, c], i) => (
              <li key={code} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{countryName(code)}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.views} · {c.clicks} clicks
                  </span>
                </div>
                <div className="ml-6 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-violet-400" style={{ width: `${(c.views / totalViews) * 100}%` }} />
                </div>
              </li>
            ))}
            {top.length === 0 && <li className="text-muted-foreground">No visits in this period.</li>}
          </ol>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-3 text-sm font-medium">Views and clicks per day</h3>
          <DailyChart daily={d.daily} />
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-1 text-sm font-medium">Time of day</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">In your local time. When the fans are awake is when to post.</p>
          <HourlyChart hourly={d.hourly} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-3 text-sm font-medium">Traffic sources</h3>
          <Bars rows={d.sources} total={totalViews} color="bg-violet-400" empty="No views yet." />
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-3 text-sm font-medium">Devices</h3>
          <Bars
            rows={d.platforms.map(([k, n]) => [k === "ios" ? "iPhone" : k === "android" ? "Android" : "Other", n])}
            total={totalViews}
            color="bg-sky-400"
            empty="No views yet."
          />
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="mb-1 text-sm font-medium">Turned away</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            {nf.format(d.bots)} bot visits · {nf.format(d.canary)} caught by the canary · {nf.format(d.blockedCountry)} blocked by country
          </p>
          <Bars rows={d.botReasons} total={Math.max(1, d.bots)} color="bg-rose-400" empty="Nothing knocked that was not a person." />
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h3 className="mb-3 text-sm font-medium">Latest activity</h3>
        <ul className="divide-y divide-border/40 text-xs">
          {d.last.map((e, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    e.bot ? "bg-rose-400" : e.kind === "click" ? "bg-pink-400" : "bg-violet-400"
                  }`}
                />
                <span className="capitalize">{e.bot ? "bot" : e.kind}</span>
                {e.reason && <span className="text-muted-foreground">· {e.reason}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {e.country ? countryName(e.country) : "—"} · {e.platform ?? "—"}
                {e.in_app ? " · in-app" : ""} ·{" "}
                {new Date(e.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
          {d.last.length === 0 && <li className="py-2 text-muted-foreground">Nothing yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function change(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || prev === 0) return null;
  return (now - prev) / prev;
}

function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] tabular-nums">
        {delta != null ? (
          <span className={delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-muted-foreground"}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta * 100).toFixed(0)}%{" "}
            <span className="text-muted-foreground">vs previous</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{hint ?? "no previous period yet"}</span>
        )}
      </p>
    </div>
  );
}

function Bars({ rows, total, color, empty }: { rows: [string, number][]; total: number; color: string; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2 text-xs">
      {rows.map(([k, n]) => (
        <li key={k}>
          <div className="flex justify-between gap-2">
            <span className="truncate">{k}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {n} · {Math.round((n / total) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (n / total) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
