"use client";

import { useState } from "react";
import { change, type AccountStats } from "@/lib/account-analytics";

type Col = {
  key: string;
  label: string;
  get: (a: AccountStats) => number | null;
  render: (a: AccountStats) => string;
  align?: "left" | "right";
};

const nf = new Intl.NumberFormat("de-DE");
const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);

/** The exact numbers, sortable. */
export function AccountTable({ accounts, showPeriod }: { accounts: AccountStats[]; showPeriod: boolean }) {
  const cols: Col[] = [
    { key: "label", label: "Account", get: () => null, render: (a) => a.label, align: "left" },
    { key: "platform", label: "Platform", get: () => null, render: (a) => a.platform, align: "left" },
    { key: "views", label: showPeriod ? "Views (period)" : "Views", get: (a) => a.views, render: (a) => nf.format(Math.round(a.views)) },
    ...(showPeriod
      ? [{ key: "change", label: "Change", get: (a: AccountStats) => change(a.views, a.viewsPrev), render: (a: AccountStats) => pct(change(a.views, a.viewsPrev)) }]
      : []),
    { key: "followers", label: "Followers", get: (a) => a.followers, render: (a) => (a.followers == null ? "—" : nf.format(a.followers)) },
    { key: "avg", label: "Avg / reel", get: (a) => a.avgPerReel, render: (a) => (a.avgPerReel == null ? "—" : nf.format(Math.round(a.avgPerReel))) },
    { key: "momentum", label: "Momentum", get: (a) => a.momentum, render: (a) => (a.momentum == null ? "—" : `${a.momentum.toFixed(1)}×`) },
    { key: "engagement", label: "Engagement", get: (a) => a.engagementRate, render: (a) => (a.engagementRate == null ? "—" : `${(a.engagementRate * 100).toFixed(1)}%`) },
    { key: "reels", label: showPeriod ? "Reels posted" : "Reels", get: (a) => a.reels, render: (a) => String(a.reels) },
  ];
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "views", dir: -1 });
  const col = cols.find((c) => c.key === sort.key);
  const rows = [...accounts].sort((a, b) => {
    if (!col) return 0;
    if (col.key === "label" || col.key === "platform") {
      return sort.dir * col.render(a).localeCompare(col.render(b));
    }
    const va = col.get(a);
    const vb = col.get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sort.dir * (va - vb);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {cols.map((c) => (
              <th
                key={c.key}
                className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium hover:text-foreground ${
                  c.align === "left" ? "text-left" : "text-right"
                }`}
                onClick={() =>
                  setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((s.dir * -1) as 1 | -1) : -1 }))
                }
              >
                {c.label}
                {sort.key === c.key && <span className="ml-1">{sort.dir === -1 ? "↓" : "↑"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr
              key={a.id}
              className="cursor-pointer border-t border-border/40 hover:bg-muted/40"
              onClick={() =>
                document.getElementById(`account-${a.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-2 py-2 tabular-nums ${
                    c.align === "left" ? "text-left" : "text-right"
                  } ${c.key === "label" ? "font-medium" : ""} ${
                    c.key === "change"
                      ? (change(a.views, a.viewsPrev) ?? 0) > 0
                        ? "text-emerald-400"
                        : (change(a.views, a.viewsPrev) ?? 0) < 0
                          ? "text-rose-400"
                          : "text-muted-foreground"
                      : ""
                  }`}
                >
                  {c.key === "label" ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-sm" style={{ background: a.color }} />
                      {a.label}
                    </span>
                  ) : (
                    c.render(a)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
