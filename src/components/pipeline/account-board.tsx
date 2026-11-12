"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  PauseCircle,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Eye,
  Flame,
  GripVertical,
  Heart,
  Link2,
  MessageCircle,
  Play,
  Plus,
  Repeat2,
  TrendingUp,
  Loader2,
  FlaskConical,
} from "lucide-react";
import {
  AccountAvatar,
  PlatformLogo,
} from "@/components/pipeline/account-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddAccountDialog } from "@/components/pipeline/accounts-actions-bar";
import {
  setAccountDisabled,
  setAccountPaused,
  setAccountLink,
  setAccountOrder,
  updateAccountSettings,
} from "@/components/pipeline/actions";
import { createTrial } from "@/app/(app)/trials/actions";
import { useWidth } from "@/components/pipeline/analytics/use-width";
import {
  PostingCalendar,
  PostingStrip,
  type Posting,
} from "@/components/pipeline/posting-calendar";

export type ReelTileData = {
  key: string;
  /** "#68" when the reel is one of ours, matched to its card in the vault. */
  number: string | null;
  caption: string | null;
  cover: string | null;
  video: string | null;
  postUrl: string | null;
  postedAt: string | null;
  views: number | null;
  viewsDelta: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagement: number | null;
  /** Times the account's median views. 2× is doing well, 5× is a hit. */
  lift: number | null;
  /** The platform's id of the post — what a trial is started on. */
  shortcode: string | null;
  /** The trial this reel is the outlier of, if one is running. */
  trialId: string | null;
};

export type AccountTileData = {
  id: string;
  handle: string;
  label: string;
  /** The name set here; empty means the label comes from the handle. */
  displayName: string;
  platform: string;
  avatar: string | null;
  color: string;
  manager: string | null;
  managerName: string | null;
  perDay: number;
  /** Trial reels a day, on top of the regular ones. */
  trialPerDay: number;
  /** Stories a day. */
  storiesPerDay: number;
  /** What went up, day by day. */
  posting: Posting;
  followers: number | null;
  followerDelta: number | null;
  views: number;
  viewsDelta: number;
  reelCount: number;
  hitsWeek: number;
  hitsTotal: number;
  goodWeek: number;
  goodTotal: number;
  lastSeen: string | null;
  /** Not read for two days while the others were. */
  stale: boolean;
  /** Disabled by the platform: kept for its history, out of everything else. */
  disabled: boolean;
  /** Paused by us: not posting, read once a week in case an old reel takes off again. */
  paused: boolean;
  linkedId: string | null;
  sortOrder: number | null;
  profileUrl: string | null;
  reels: ReelTileData[];
  /** Auto-posting through the planner, when the account uses it. */
  autopost: {
    connected: boolean;
    /** Posts still ahead. */
    scheduled: number;
    next: string | null;
    /** The last one planned: how far ahead the account is filled. */
    until: string | null;
    failed: number;
    posted7: number;
  } | null;
};

type SortKey = "all" | "va" | "meta" | "views" | "followers" | "inactive";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "va", label: "VA" },
  { key: "meta", label: "Meta" },
  { key: "views", label: "Views" },
  { key: "followers", label: "Followers" },
  { key: "inactive", label: "Inactive" },
];

const nf = new Intl.NumberFormat("de-DE");
const short = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}k`
      : nf.format(n);

/** Not posting: disabled by the platform, paused by us, or parked at 0 reels a day and not auto-posting either. */
const inactive = (a: AccountTileData) => a.disabled || a.paused || (a.perDay === 0 && !a.autopost);

type Group = {
  key: string;
  title: string | null;
  note?: string;
  tiles: AccountTileData[];
};

/**
 * The accounts as tiles: who they are, who runs them, how they are doing.
 * Click a tile and its reels open underneath, the full width of its row,
 * like a card in the vault.
 *
 *   All        every account, in the order dragged into; inactive ones last
 *   VA         one row per VA, with the accounts that VA runs
 *   Meta       one row per Meta setup, the Facebook page and its Instagram
 *   Views      active accounts by views
 *   Followers  active accounts by followers
 *   Inactive   disabled, paused and parked accounts, kept for their history
 */
export function AccountBoard({
  accounts,
  canEdit,
}: {
  accounts: AccountTileData[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<SortKey>("all");
  const [order, setOrder] = useState<string[]>(() => defaultOrder(accounts));
  const [open, setOpen] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startSave] = useTransition();
  const { ref, width } = useWidth<HTMLDivElement>(1100);

  useEffect(() => setOrder(defaultOrder(accounts)), [accounts]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("accounts-view") as SortKey | null;
      if (saved && SORTS.some((s) => s.key === saved)) setSort(saved);
    } catch {}
  }, []);

  const byId = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  // The charts above link here with #account-<id>: open that tile, in a
  // view that has it.
  useEffect(() => {
    const go = () => {
      const m = location.hash.match(/^#account-(.+)$/);
      if (!m) return;
      setOpen(m[1]);
      const a = byId.get(m[1]);
      if (a && inactive(a))
        setSort((s) => (s === "all" || s === "inactive" ? s : "all"));
      requestAnimationFrame(() =>
        document
          .getElementById(`account-${m[1]}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [byId]);

  const groups: Group[] = useMemo(() => {
    const ordered = order
      .map((id) => byId.get(id))
      .filter((a): a is AccountTileData => !!a);
    const active = ordered.filter((a) => !inactive(a));
    const vaName = (a: AccountTileData) =>
      a.managerName ?? (a.manager ? `@${a.manager}` : null);
    // Facebook before Instagram inside a row, so a pair always reads the same way.
    const byPlatform = (x: AccountTileData, y: AccountTileData) =>
      x.platform.localeCompare(y.platform);

    switch (sort) {
      case "views":
        return [
          {
            key: "views",
            title: null,
            tiles: [...active].sort((a, b) => b.views - a.views),
          },
        ];
      case "followers":
        return [
          {
            key: "followers",
            title: null,
            tiles: [...active].sort(
              (a, b) => (b.followers ?? -1) - (a.followers ?? -1),
            ),
          },
        ];
      case "inactive":
        return [
          {
            key: "inactive",
            title: null,
            tiles: ordered
              .filter(inactive)
              .sort((a, b) => Number(b.disabled) - Number(a.disabled)),
          },
        ];
      case "va": {
        const rows = new Map<string, AccountTileData[]>();
        for (const a of active) {
          const k = vaName(a) ?? "";
          rows.set(k, [...(rows.get(k) ?? []), a]);
        }
        return Array.from(rows.entries())
          .sort(([x], [y]) => (!x !== !y ? (x ? -1 : 1) : x.localeCompare(y)))
          .map(([name, tiles]) => ({
            key: `va-${name}`,
            title: name || "No VA yet",
            note: `${tiles.length} account${tiles.length === 1 ? "" : "s"}`,
            tiles: [...tiles].sort(byPlatform),
          }));
      }
      case "meta": {
        const done = new Set<string>();
        const pairs: Group[] = [];
        const singles: AccountTileData[] = [];
        for (const a of active) {
          if (done.has(a.id)) continue;
          const partner = a.linkedId ? byId.get(a.linkedId) : undefined;
          if (partner && !inactive(partner)) {
            done.add(a.id);
            done.add(partner.id);
            const tiles = [a, partner].sort(byPlatform);
            pairs.push({
              key: `meta-${tiles[0].id}`,
              title: tiles.map((t) => t.label).join(" + "),
              note: vaName(a) ?? vaName(partner) ?? "no VA yet",
              tiles,
            });
          } else {
            done.add(a.id);
            singles.push(a);
          }
        }
        pairs.sort((x, y) => (x.note ?? "").localeCompare(y.note ?? ""));
        return singles.length
          ? [
              ...pairs,
              {
                key: "meta-none",
                title: "Not in a Meta setup",
                note: "link them in the open tile",
                tiles: singles,
              },
            ]
          : pairs;
      }
      default:
        return [
          {
            key: "all",
            title: null,
            tiles: [...active, ...ordered.filter(inactive)],
          },
        ];
    }
  }, [order, byId, sort]);

  const GAP = 12;
  const MIN = 270;
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN + GAP)));

  const draggable = canEdit && sort === "all";
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = order.filter((id) => id !== dragId);
    next.splice(next.indexOf(targetId), 0, dragId);
    setOrder(next);
    setDragId(null);
    startSave(async () => {
      const res = await setAccountOrder(next);
      if (res.error) toast.error(res.error);
    });
  };
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    history.replaceState(
      null,
      "",
      next ? `#account-${next}` : location.pathname + location.search,
    );
  };
  const plusTile = canEdit && sort !== "inactive" && (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="flex min-h-[172px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/50 text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-xs font-medium">Add account</span>
    </button>
  );
  const grouped = groups.some((g) => g.title);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Per account</h3>
          <p className="text-[11px] text-muted-foreground">
            Click a tile for its reels
            {draggable ? " · drag tiles to reorder" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted/40 p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setSort(s.key);
                try {
                  localStorage.setItem("accounts-view", s.key);
                } catch {}
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                sort === s.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
              {s.key === "inactive" && accounts.some(inactive) && (
                <span className="ml-1 tabular-nums opacity-60">
                  {accounts.filter(inactive).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className={grouped ? "space-y-5" : ""}>
        {groups.map((g, gi) => {
          const last = gi === groups.length - 1;
          const openIdx = g.tiles.findIndex((a) => a.id === open);
          // The open tile's reels go under the row it sits in.
          const panelAfter =
            openIdx < 0
              ? -1
              : Math.min(
                  g.tiles.length - 1,
                  Math.floor(openIdx / cols) * cols + cols - 1,
                );
          return (
            <section key={g.key}>
              {g.title && (
                <div className="mb-2 flex items-baseline gap-2 border-b border-border/40 pb-1.5">
                  <h4 className="text-xs font-semibold">{g.title}</h4>
                  {g.note && (
                    <span className="text-[11px] text-muted-foreground">
                      {g.note}
                    </span>
                  )}
                </div>
              )}
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                }}
              >
                {g.tiles.map((a, i) => (
                  <FragmentWithPanel
                    key={a.id}
                    tile={
                      <AccountTile
                        a={a}
                        partner={
                          a.linkedId ? (byId.get(a.linkedId) ?? null) : null
                        }
                        open={open === a.id}
                        draggable={draggable}
                        dragging={dragId === a.id}
                        onToggle={() => toggle(a.id)}
                        onDragStart={() => setDragId(a.id)}
                        onDragEnd={() => setDragId(null)}
                        onDrop={() => drop(a.id)}
                      />
                    }
                    panel={
                      i === panelAfter ? (
                        <AccountPanel
                          a={g.tiles[openIdx]}
                          others={accounts.filter(
                            (o) => o.id !== g.tiles[openIdx].id,
                          )}
                          canEdit={canEdit}
                          onChanged={() => router.refresh()}
                        />
                      ) : null
                    }
                  />
                ))}
                {!grouped && last && plusTile}
                {g.tiles.length === 0 && (
                  <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
                    {sort === "inactive"
                      ? "No disabled, paused or parked accounts."
                      : "No accounts here."}
                  </p>
                )}
              </div>
            </section>
          );
        })}
        {grouped && plusTile && (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {plusTile}
          </div>
        )}
      </div>
      {canEdit && <AddAccountDialog open={adding} setOpen={setAdding} />}
    </div>
  );
}

function FragmentWithPanel({
  tile,
  panel,
}: {
  tile: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <>
      {tile}
      {panel}
    </>
  );
}

function defaultOrder(accounts: AccountTileData[]): string[] {
  return [...accounts]
    .sort((a, b) => {
      if (a.sortOrder != null && b.sortOrder != null)
        return a.sortOrder - b.sortOrder;
      if (a.sortOrder != null) return -1;
      if (b.sortOrder != null) return 1;
      return b.views - a.views;
    })
    .map((a) => a.id);
}

const PLATFORM_BG: Record<string, string> = {
  instagram:
    "linear-gradient(135deg, rgba(254,218,117,0.14) 0%, rgba(250,126,30,0.12) 25%, rgba(214,41,118,0.16) 55%, rgba(150,47,191,0.14) 80%, rgba(79,91,213,0.12) 100%)",
  facebook:
    "linear-gradient(135deg, rgba(24,119,242,0.22) 0%, rgba(24,119,242,0.08) 100%)",
};

function ago(iso: string | null): string {
  if (!iso) return "not read yet";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "read just now";
  if (h < 24) return `read ${Math.round(h)}h ago`;
  return `read ${Math.round(h / 24)}d ago`;
}

function AccountTile({
  a,
  partner,
  open,
  draggable,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  a: AccountTileData;
  partner: AccountTileData | null;
  open: boolean;
  draggable: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  const parked = a.perDay === 0 && !a.disabled && !a.paused && !a.autopost;
  return (
    <div
      id={`account-${a.id}`}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) =>
        (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())
      }
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`group relative scroll-mt-4 cursor-pointer select-none overflow-hidden rounded-2xl border p-4 text-left transition-all ${
        open
          ? "border-primary/70 ring-2 ring-primary/40"
          : "border-border/50 hover:border-border"
      } ${dragging ? "opacity-40" : ""} ${over ? "ring-2 ring-primary/60" : ""} ${parked ? "opacity-70" : ""} ${
        a.disabled || a.paused ? "opacity-50 grayscale" : ""
      }`}
      style={{
        background: `${PLATFORM_BG[a.platform] ?? ""}, hsl(var(--card) / var(--card-a, 1))`,
      }}
    >
      <div className="flex items-start gap-3">
        <AccountAvatar
          src={a.avatar}
          platform={a.platform}
          label={a.label}
          size={48}
          color={a.color}
          badge={false}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{a.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {a.managerName ?? (a.manager ? `@${a.manager}` : "no VA yet")}
          </p>
          {partner && (
            <p
              className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground"
              title="Linked in one Meta setup"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <PlatformLogo
                platform={partner.platform}
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{partner.label}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {draggable && (
            <GripVertical className="h-4 w-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
          <PlatformLogo platform={a.platform} className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="reels" value={nf.format(a.reelCount)} />
        <Stat
          label="views"
          value={short(a.views)}
          delta={a.viewsDelta > 0 ? `+${short(a.viewsDelta)}` : null}
          title={`${nf.format(a.views)} views · +${nf.format(a.viewsDelta)} since the previous reading`}
        />
        <Stat
          label="followers"
          value={a.followers == null ? "—" : nf.format(a.followers)}
          delta={
            a.followerDelta
              ? `${a.followerDelta > 0 ? "▲" : "▼"}${Math.abs(a.followerDelta)}`
              : null
          }
          down={(a.followerDelta ?? 0) < 0}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <HitBadge kind="hit" week={a.hitsWeek} total={a.hitsTotal} />
        <HitBadge kind="good" week={a.goodWeek} total={a.goodTotal} />
        <span className="ml-auto text-[10px] text-muted-foreground">
          7 days (total)
        </span>
      </div>

      {!a.disabled && !a.paused && (
        <PostingStrip
          posting={a.posting}
          need={{ r: a.perDay, t: a.trialPerDay, s: a.storiesPerDay }}
        />
      )}

      {a.autopost && <AutopostStrip accountId={a.id} auto={a.autopost} />}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        {a.paused && !a.disabled ? (
          <span className="flex items-center gap-1 font-medium text-slate-300">
            <PauseCircle className="h-3 w-3 shrink-0" />
            paused · checked on Sundays
          </span>
        ) : a.disabled ? (
          <span className="flex items-center gap-1 font-medium text-rose-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            disabled by{" "}
            {a.platform === "facebook"
              ? "Facebook"
              : a.platform === "instagram"
                ? "Instagram"
                : "the platform"}
          </span>
        ) : a.stale ? (
          <span className="flex min-w-0 items-center gap-1 text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">
              not readable since{" "}
              {a.lastSeen
                ? new Date(a.lastSeen).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                  })
                : "—"}
            </span>
          </span>
        ) : (
          <span>
            {parked
              ? "parked · 0 reels a day"
              : `${a.perDay} a day · ${ago(a.lastSeen)}`}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>
    </div>
  );
}

/** The planner at a glance: how far ahead the account is filled, and what needs a look. */
function AutopostStrip({ accountId, auto }: { accountId: string; auto: NonNullable<AccountTileData["autopost"]> }) {
  const days = auto.until ? Math.max(0, Math.ceil((new Date(auto.until).getTime() - Date.now()) / 86_400_000)) : 0;
  const tone = days <= 2 ? "text-rose-400" : days <= 5 ? "text-amber-300" : "text-emerald-400";
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("de-DE", o);
  return (
    <a
      href={`/planner/${accountId}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 block rounded-xl border border-primary/30 bg-primary/[0.06] p-2.5 transition-colors hover:border-primary/60"
    >
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-primary">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3" /> Auto-post
        </span>
        <span className={auto.connected ? "text-emerald-400" : "text-amber-300"}>
          {auto.connected ? "connected" : "not connected"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-lg font-semibold leading-none tabular-nums">{auto.scheduled}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">scheduled</p>
        </div>
        <div>
          <p className={`text-lg font-semibold leading-none tabular-nums ${tone}`}>{days}d</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground" suppressHydrationWarning>
            {auto.until ? `until ${fmt(auto.until, { weekday: "short", day: "2-digit", month: "2-digit" })}` : "nothing planned"}
          </p>
        </div>
        <div>
          <p className="truncate text-sm font-semibold leading-tight" suppressHydrationWarning>
            {auto.next ? fmt(auto.next, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">next post</p>
        </div>
      </div>
      {(auto.failed > 0 || auto.posted7 > 0) && (
        <p className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          {auto.posted7 > 0 && <span>{auto.posted7} auto-posted · 7 days</span>}
          {auto.failed > 0 && (
            <span className="flex items-center gap-0.5 font-semibold text-rose-400">
              <AlertTriangle className="h-3 w-3" /> {auto.failed} failed
            </span>
          )}
        </p>
      )}
    </a>
  );
}

function Stat({
  label,
  value,
  delta,
  down,
  title,
}: {
  label: string;
  value: string;
  delta?: string | null;
  down?: boolean;
  title?: string;
}) {
  return (
    <div title={title}>
      <p className="flex items-baseline gap-1 text-base font-semibold tabular-nums leading-tight">
        {value}
        {delta && (
          <span
            className={`text-[10px] font-medium ${down ? "text-rose-400" : "text-emerald-400"}`}
          >
            {delta}
          </span>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function HitBadge({
  kind,
  week,
  total,
}: {
  kind: "hit" | "good";
  week: number;
  total: number;
}) {
  const hit = kind === "hit";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        hit
          ? "border-amber-400/80 bg-amber-400/10 text-amber-300"
          : "border-emerald-400/80 bg-emerald-400/10 text-emerald-300"
      } ${week === 0 && total === 0 ? "opacity-40" : ""}`}
      title={
        hit
          ? "Hits — 5× the account's median or more"
          : "Doing well — 2× to 5× the account's median"
      }
    >
      {hit ? <Flame className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {week}
      <span className="font-normal opacity-70">({total})</span>
    </span>
  );
}

function AccountPanel({
  a,
  others,
  canEdit,
  onChanged,
}: {
  a: AccountTileData;
  others: AccountTileData[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [switching, startSwitch] = useTransition();
  const [saving, startSave] = useTransition();
  const initial = {
    displayName: a.displayName,
    handle: a.handle,
    manager: a.manager ?? "",
    perDay: String(a.perDay),
    trialPerDay: String(a.trialPerDay),
    storiesPerDay: String(a.storiesPerDay),
    linkedId: a.linkedId ?? "none",
  };
  const [f, setF] = useState(initial);
  useEffect(
    () => setF(initial),
    [
      a.id,
      a.displayName,
      a.handle,
      a.manager,
      a.perDay,
      a.trialPerDay,
      a.storiesPerDay,
      a.linkedId,
    ],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  // A Meta setup is a Facebook page and an Instagram account.
  const candidates = others.filter(
    (o) => o.platform !== a.platform && !o.disabled,
  );
  const partner = a.linkedId
    ? others.find((o) => o.id === a.linkedId)
    : undefined;

  function save() {
    startSave(async () => {
      const res = await updateAccountSettings(a.id, {
        displayName: f.displayName,
        handle: f.handle,
        manager: f.manager,
        perDay: Number(f.perDay),
        trialPerDay: Number(f.trialPerDay),
        storiesPerDay: Number(f.storiesPerDay),
      });
      if (res.error) return void toast.error(res.error);
      const link = f.linkedId === "none" ? null : f.linkedId;
      if (link !== (a.linkedId ?? null)) {
        const linked = await setAccountLink(a.id, link);
        if (linked.error) return void toast.error(linked.error);
      }
      toast.success("Saved");
      onChanged();
    });
  }

  return (
    <div className="col-span-full animate-in fade-in slide-in-from-top-1 rounded-2xl border border-border/60 bg-card/70 p-4 duration-200">
      <div className="flex flex-wrap items-center gap-3">
        <AccountAvatar
          src={a.avatar}
          platform={a.platform}
          label={a.label}
          size={36}
          color={a.color}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{a.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {a.managerName ?? (a.manager ? `@${a.manager}` : "no VA yet")}
            {partner ? ` · Meta setup with ${partner.label}` : ""}
          </p>
        </div>
        {a.profileUrl && (
          <a
            href={a.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Open on{" "}
            {a.platform === "facebook"
              ? "Facebook"
              : a.platform === "instagram"
                ? "Instagram"
                : "the platform"}
            <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
        {canEdit && a.platform === "instagram" && !a.disabled && (
          <a
            href={`/planner/${a.id}`}
            className={`${a.profileUrl ? "" : "ml-auto "}inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Auto-post planner
          </a>
        )}
      </div>

      {canEdit && (
        <div className="mt-4 rounded-xl border border-border/40 bg-background/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.4fr_1fr_0.6fr_0.6fr_0.6fr_1.3fr]">
            <Field label="Name" hint="shown on the tiles and charts">
              <Input
                value={f.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder={a.label}
                className="h-9 text-sm"
              />
            </Field>
            <Field
              label={a.platform === "facebook" ? "Page URL" : "Handle"}
              hint="what the scrape reads"
            >
              <Input
                value={f.handle}
                onChange={(e) => set("handle", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="VA" hint="Telegram username">
              <Input
                value={f.manager}
                onChange={(e) => set("manager", e.target.value)}
                placeholder="nobody yet"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Reels a day">
              <Input
                type="number"
                min={0}
                max={50}
                value={f.perDay}
                onChange={(e) => set("perDay", e.target.value)}
                className="h-9 text-sm tabular-nums"
              />
            </Field>
            <Field label="Trial reels a day">
              <Input
                type="number"
                min={0}
                max={50}
                value={f.trialPerDay}
                onChange={(e) => set("trialPerDay", e.target.value)}
                className="h-9 text-sm tabular-nums"
              />
            </Field>
            <Field label="Stories a day">
              <Input
                type="number"
                min={0}
                max={50}
                value={f.storiesPerDay}
                onChange={(e) => set("storiesPerDay", e.target.value)}
                className="h-9 text-sm tabular-nums"
              />
            </Field>
            <Field
              label="Meta setup"
              hint={
                a.platform === "facebook"
                  ? "its Instagram account"
                  : "its Facebook page"
              }
            >
              <Select
                value={f.linkedId}
                onValueChange={(v) => set("linkedId", v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Not linked</span>
                  </SelectItem>
                  {candidates.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="flex items-center gap-2">
                        <PlatformLogo
                          platform={o.platform}
                          className="h-3.5 w-3.5"
                        />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setF(initial)}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
            {!a.disabled && (
              <button
                type="button"
                disabled={switching}
                onClick={() =>
                  startSwitch(async () => {
                    const res = await setAccountPaused(a.id, !a.paused);
                    if (res.error) toast.error(res.error);
                    else onChanged();
                  })
                }
                className={`ml-auto h-8 rounded-md border px-3 text-xs transition-colors ${
                  a.paused
                    ? "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                    : "border-slate-500/40 text-slate-300 hover:bg-slate-500/10"
                }`}
              >
                {switching ? "…" : a.paused ? "Resume account" : "Pause account"}
              </button>
            )}
            <button
              type="button"
              disabled={switching}
              onClick={() => {
                if (
                  !a.disabled &&
                  !confirm(
                    `Mark ${a.label} as disabled? It stops being scraped and counted, and stays here with its history.`,
                  )
                )
                  return;
                startSwitch(async () => {
                  const res = await setAccountDisabled(a.id, !a.disabled);
                  if (res.error) toast.error(res.error);
                  else onChanged();
                });
              }}
              className={`${a.disabled ? "ml-auto " : ""}h-8 rounded-md border px-3 text-xs transition-colors ${
                a.disabled
                  ? "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                  : "border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
              }`}
            >
              {switching
                ? "…"
                : a.disabled
                  ? "Account is back — enable"
                  : "Mark as disabled"}
            </button>
          </div>
        </div>
      )}

      {/* What went up, day by day, left of the reels themselves. */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        <PostingCalendar
          posting={a.posting}
          need={{ r: a.perDay, t: a.trialPerDay, s: a.storiesPerDay }}
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Reels{" "}
            {a.reels.length > 0 && (
              <span className="tabular-nums">· {a.reels.length}</span>
            )}
          </p>
          {a.reels.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {a.lastSeen
                ? "No reels on this account yet. A private account shows followers only."
                : "Not read yet — the first read runs right after an account is added, then every morning."}
            </p>
          ) : (
            <div className="-mx-1 mt-2 flex gap-3 overflow-x-auto px-1 pb-2">
              {a.reels.map((r) => (
                <ReelTile
                  key={r.key}
                  r={r}
                  accountId={a.id}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="flex items-baseline gap-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal opacity-60">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * One reel, laid out the same way whatever is known about it: the cover,
 * our number when it is one of ours, the caption on two lines, views and
 * what they did since the last reading, then likes, comments, shares.
 */
function ReelTile({
  r,
  accountId,
  canEdit,
}: {
  r: ReelTileData;
  accountId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const [starting, startTrial] = useTransition();
  const hit = r.lift != null && r.lift >= 5;
  const good = r.lift != null && r.lift >= 2 && !hit;
  return (
    <div className="group/reel w-40 shrink-0">
      <div
        className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-muted/40 ${
          hit
            ? "ring-2 ring-amber-400"
            : good
              ? "ring-2 ring-emerald-400"
              : "ring-1 ring-border/40"
        }`}
      >
        {playing && r.video ? (
          <video
            src={r.video}
            autoPlay
            controls
            playsInline
            className="h-full w-full bg-black object-cover"
          />
        ) : (
          <button
            type="button"
            className="group/cover block h-full w-full"
            onClick={() =>
              r.video
                ? setPlaying(true)
                : r.postUrl && window.open(r.postUrl, "_blank", "noreferrer")
            }
            title={r.video ? "Play our cut" : "Open the post"}
          >
            {r.cover && !broken ? (
              <img
                src={r.cover}
                alt=""
                loading="lazy"
                onError={() => setBroken(true)}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center px-3 text-center text-[10px] text-muted-foreground">
                no cover
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
            {r.video && (
              <span className="absolute inset-0 flex items-center justify-center opacity-80 transition-opacity group-hover/cover:opacity-100">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                  <Play className="h-4 w-4 fill-white text-white" />
                </span>
              </span>
            )}
          </button>
        )}
        {!playing && (hit || good) && (
          <span
            className={`absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-black ${
              hit ? "bg-amber-400" : "bg-emerald-400"
            }`}
            title={`${r.lift!.toFixed(1)}× this account's median views`}
          >
            {hit ? (
              <Flame className="h-3 w-3" />
            ) : (
              <TrendingUp className="h-3 w-3" />
            )}
            {r.lift!.toFixed(1)}×
          </span>
        )}
        {!playing && r.number && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {r.number}
          </span>
        )}
        {!playing && (r.trialId || (canEdit && r.shortcode)) && (
          <button
            type="button"
            disabled={starting}
            onClick={(e) => {
              e.stopPropagation();
              if (r.trialId) return router.push(`/trials/${r.trialId}`);
              startTrial(async () => {
                const res = await createTrial({
                  accountId,
                  shortcode: r.shortcode!,
                });
                if (res.error && res.id) {
                  // Already in Trial-Maxxing: say so and open that one.
                  toast.message(res.error);
                  return router.push(`/trials/${res.id}`);
                }
                if (res.error || !res.id)
                  return void toast.error(res.error ?? "Could not start");
                toast.success("Trial-Maxxing opened");
                router.push(`/trials/${res.id}`);
              });
            }}
            className={`absolute bottom-1.5 left-1.5 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-bold backdrop-blur-sm transition-colors ${
              r.trialId
                ? "bg-fuchsia-500 text-white"
                : hit
                  ? "bg-fuchsia-500/90 text-white hover:bg-fuchsia-400"
                  : "bg-black/55 text-white/80 opacity-0 hover:bg-fuchsia-500 group-hover/reel:opacity-100"
            }`}
            title={
              r.trialId
                ? "Open its Trial-Maxxing"
                : "Start Trial-Maxxing on this reel"
            }
          >
            {starting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FlaskConical className="h-3 w-3" />
            )}
            {r.trialId ? "TM" : "Trial-Max"}
          </button>
        )}
        {!playing && r.postUrl && (
          <a
            href={r.postUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/80"
            title="Open on the platform"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <p
        className="mt-2 line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-muted-foreground"
        title={r.caption ?? undefined}
      >
        {r.caption?.trim() || (
          <span className="italic opacity-60">no caption</span>
        )}
      </p>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="flex items-baseline gap-1 text-sm font-semibold tabular-nums">
          <Eye className="h-3.5 w-3.5 self-center text-muted-foreground" />
          {r.views != null ? nf.format(r.views) : "—"}
          {r.viewsDelta != null && r.viewsDelta !== 0 && (
            <span
              className={`text-[10px] font-medium ${r.viewsDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {r.viewsDelta > 0 ? "+" : ""}
              {nf.format(r.viewsDelta)}
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {r.postedAt
            ? new Date(r.postedAt).toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
              })
            : ""}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2.5 text-[10px] tabular-nums text-muted-foreground">
        <span className="flex items-center gap-0.5" title="likes">
          <Heart className="h-3 w-3" />
          {r.likes != null ? short(r.likes) : "—"}
        </span>
        <span className="flex items-center gap-0.5" title="comments">
          <MessageCircle className="h-3 w-3" />
          {r.comments != null ? short(r.comments) : "—"}
        </span>
        <span className="flex items-center gap-0.5" title="shares">
          <Repeat2 className="h-3 w-3" />
          {r.shares != null ? short(r.shares) : "—"}
        </span>
        {r.engagement != null && (
          <span className="ml-auto" title="likes + comments + shares per view">
            {(r.engagement * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
