"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
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
} from "lucide-react";
import { AccountAvatar, PlatformLogo } from "@/components/pipeline/account-avatar";
import { AccountControls } from "@/components/pipeline/account-controls";
import { AddAccountDialog } from "@/components/pipeline/accounts-actions-bar";
import { setAccountLink, setAccountOrder } from "@/components/pipeline/actions";
import { useWidth } from "@/components/pipeline/analytics/use-width";

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
};

export type AccountTileData = {
  id: string;
  handle: string;
  label: string;
  platform: string;
  avatar: string | null;
  color: string;
  manager: string | null;
  managerName: string | null;
  perDay: number;
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
  linkedId: string | null;
  sortOrder: number | null;
  profileUrl: string | null;
  reels: ReelTileData[];
};

type SortKey = "custom" | "meta" | "views" | "followers" | "hits" | "va";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "custom", label: "My order" },
  { key: "meta", label: "Meta setup" },
  { key: "views", label: "Views" },
  { key: "followers", label: "Followers" },
  { key: "hits", label: "Hits this week" },
  { key: "va", label: "VA" },
];

const nf = new Intl.NumberFormat("de-DE");
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : nf.format(n);

/**
 * The accounts as tiles: who they are, who runs them, how they are doing.
 * Click a tile and its reels open underneath, the full width of the grid,
 * like a card in the vault. Tiles can be put in any order and dragged.
 */
export function AccountBoard({ accounts, canEdit }: { accounts: AccountTileData[]; canEdit: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState<SortKey>("custom");
  const [order, setOrder] = useState<string[]>(() => defaultOrder(accounts));
  const [open, setOpen] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startSave] = useTransition();
  const { ref, width } = useWidth<HTMLDivElement>(1100);

  useEffect(() => setOrder(defaultOrder(accounts)), [accounts]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("accounts-sort") as SortKey | null;
      if (saved && SORTS.some((s) => s.key === saved)) setSort(saved);
    } catch {}
  }, []);

  // The charts above link here with #account-<id>: open that tile.
  useEffect(() => {
    const go = () => {
      const m = location.hash.match(/^#account-(.+)$/);
      if (!m) return;
      setOpen(m[1]);
      requestAnimationFrame(() =>
        document.getElementById(`account-${m[1]}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const sorted = useMemo(() => {
    const list = order.map((id) => byId.get(id)).filter((a): a is AccountTileData => !!a);
    const va = (a: AccountTileData) => (a.managerName ?? a.manager ?? "~").toLowerCase();
    switch (sort) {
      case "views":
        return [...list].sort((a, b) => b.views - a.views);
      case "followers":
        return [...list].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1));
      case "hits":
        return [...list].sort((a, b) => b.hitsWeek * 10 + b.goodWeek - (a.hitsWeek * 10 + a.goodWeek));
      case "va":
        return [...list].sort((a, b) => va(a).localeCompare(va(b)) || a.platform.localeCompare(b.platform));
      case "meta": {
        // Pairs side by side, Facebook first, grouped by who runs them.
        const out: AccountTileData[] = [];
        const done = new Set<string>();
        const bySetup = [...list].sort((a, b) => va(a).localeCompare(va(b)) || a.platform.localeCompare(b.platform));
        for (const a of bySetup) {
          if (done.has(a.id)) continue;
          const partner = a.linkedId ? byId.get(a.linkedId) : undefined;
          const pair = partner && !done.has(partner.id) ? [a, partner].sort((x, y) => x.platform.localeCompare(y.platform)) : [a];
          pair.forEach((p) => {
            out.push(p);
            done.add(p.id);
          });
        }
        return out;
      }
      default:
        return list;
    }
  }, [order, byId, sort]);

  const GAP = 12;
  const MIN = 270;
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN + GAP)));
  const openIdx = sorted.findIndex((a) => a.id === open);
  // The open tile's reels go under the row it sits in.
  const panelAfter = openIdx < 0 ? -1 : Math.min(sorted.length - 1, Math.floor(openIdx / cols) * cols + cols - 1);

  const draggable = canEdit && sort === "custom";
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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Per account</h3>
          <p className="text-[11px] text-muted-foreground">
            Click a tile for its reels{draggable ? " · drag tiles to reorder" : ""}
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
                  localStorage.setItem("accounts-sort", s.key);
                } catch {}
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                sort === s.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {sorted.map((a, i) => (
          <FragmentWithPanel
            key={a.id}
            tile={
              <AccountTile
                a={a}
                partner={a.linkedId ? byId.get(a.linkedId) ?? null : null}
                open={open === a.id}
                draggable={draggable}
                dragging={dragId === a.id}
                onToggle={() => {
                  const next = open === a.id ? null : a.id;
                  setOpen(next);
                  history.replaceState(null, "", next ? `#account-${next}` : location.pathname + location.search);
                }}
                onDragStart={() => setDragId(a.id)}
                onDragEnd={() => setDragId(null)}
                onDrop={() => drop(a.id)}
              />
            }
            panel={
              i === panelAfter && openIdx >= 0 ? (
                <AccountPanel
                  a={sorted[openIdx]}
                  others={accounts.filter((o) => o.id !== sorted[openIdx].id)}
                  canEdit={canEdit}
                  onChanged={() => router.refresh()}
                />
              ) : null
            }
          />
        ))}
        {canEdit && (
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
        )}
      </div>
      {canEdit && <AddAccountDialog open={adding} setOpen={setAdding} />}
    </div>
  );
}

function FragmentWithPanel({ tile, panel }: { tile: React.ReactNode; panel: React.ReactNode }) {
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
      if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
      if (a.sortOrder != null) return -1;
      if (b.sortOrder != null) return 1;
      return b.views - a.views;
    })
    .map((a) => a.id);
}

const PLATFORM_BG: Record<string, string> = {
  instagram:
    "linear-gradient(135deg, rgba(254,218,117,0.14) 0%, rgba(250,126,30,0.12) 25%, rgba(214,41,118,0.16) 55%, rgba(150,47,191,0.14) 80%, rgba(79,91,213,0.12) 100%)",
  facebook: "linear-gradient(135deg, rgba(24,119,242,0.22) 0%, rgba(24,119,242,0.08) 100%)",
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
  const parked = a.perDay === 0;
  return (
    <div
      id={`account-${a.id}`}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
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
        open ? "border-primary/70 ring-2 ring-primary/40" : "border-border/50 hover:border-border"
      } ${dragging ? "opacity-40" : ""} ${over ? "ring-2 ring-primary/60" : ""} ${parked ? "opacity-70" : ""}`}
      style={{ background: `${PLATFORM_BG[a.platform] ?? ""}, hsl(var(--card))` }}
    >
      <div className="flex items-start gap-3">
        <AccountAvatar src={a.avatar} platform={a.platform} label={a.label} size={48} color={a.color} badge={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{a.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {a.managerName ?? (a.manager ? `@${a.manager}` : "no VA yet")}
          </p>
          {partner && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground" title="Linked in one Meta setup">
              <Link2 className="h-3 w-3 shrink-0" />
              <PlatformLogo platform={partner.platform} className="h-3 w-3 shrink-0" />
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
          delta={a.followerDelta ? `${a.followerDelta > 0 ? "▲" : "▼"}${Math.abs(a.followerDelta)}` : null}
          down={(a.followerDelta ?? 0) < 0}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <HitBadge kind="hit" week={a.hitsWeek} total={a.hitsTotal} />
        <HitBadge kind="good" week={a.goodWeek} total={a.goodTotal} />
        <span className="ml-auto text-[10px] text-muted-foreground">7 days (total)</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        {a.stale ? (
          <span className="flex min-w-0 items-center gap-1 text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">
              not readable since{" "}
              {a.lastSeen ? new Date(a.lastSeen).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "—"}
            </span>
          </span>
        ) : (
          <span>{parked ? "parked · 0 reels a day" : `${a.perDay} a day · ${ago(a.lastSeen)}`}</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
    </div>
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
        {delta && <span className={`text-[10px] font-medium ${down ? "text-rose-400" : "text-emerald-400"}`}>{delta}</span>}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function HitBadge({ kind, week, total }: { kind: "hit" | "good"; week: number; total: number }) {
  const hit = kind === "hit";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        hit ? "border-amber-400/80 bg-amber-400/10 text-amber-300" : "border-emerald-400/80 bg-emerald-400/10 text-emerald-300"
      } ${week === 0 && total === 0 ? "opacity-40" : ""}`}
      title={hit ? "Hits — 5× the account's median or more" : "Doing well — 2× to 5× the account's median"}
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
  const [linking, startLink] = useTransition();
  const candidates = others.filter((o) => o.platform !== a.platform);
  return (
    <div className="col-span-full animate-in fade-in slide-in-from-top-1 rounded-2xl border border-border/60 bg-card/70 p-4 duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar src={a.avatar} platform={a.platform} label={a.label} size={28} />
          <p className="truncate text-sm font-semibold">{a.label}</p>
          {a.profileUrl && (
            <a
              href={a.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              open profile <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
        </div>
        {canEdit && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Meta setup with
            <select
              value={a.linkedId ?? ""}
              disabled={linking}
              onChange={(e) =>
                startLink(async () => {
                  const res = await setAccountLink(a.id, e.target.value || null);
                  if (res.error) toast.error(res.error);
                  else onChanged();
                })
              }
              className="h-7 rounded-md border border-border/50 bg-card px-2 text-[11px] text-foreground"
            >
              <option value="">nothing linked</option>
              {candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.platform === "facebook" ? "FB" : "IG"} · {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <AccountControls accountId={a.id} handle={a.handle} perDay={a.perDay} manager={a.manager} editable={canEdit} />

      {a.reels.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing read from this account yet — the daily scrape fills this row. A private account shows followers only.
        </p>
      ) : (
        <div className="-mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-2">
          {a.reels.map((r) => (
            <ReelTile key={r.key} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One reel, laid out the same way whatever is known about it: the cover,
 * our number when it is one of ours, the caption on two lines, views and
 * what they did since the last reading, then likes, comments, shares.
 */
function ReelTile({ r }: { r: ReelTileData }) {
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const hit = r.lift != null && r.lift >= 5;
  const good = r.lift != null && r.lift >= 2 && !hit;
  return (
    <div className="w-40 shrink-0">
      <div
        className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-muted/40 ${
          hit ? "ring-2 ring-amber-400" : good ? "ring-2 ring-emerald-400" : "ring-1 ring-border/40"
        }`}
      >
        {playing && r.video ? (
          <video src={r.video} autoPlay controls playsInline className="h-full w-full bg-black object-cover" />
        ) : (
          <button
            type="button"
            className="group/cover block h-full w-full"
            onClick={() => (r.video ? setPlaying(true) : r.postUrl && window.open(r.postUrl, "_blank", "noreferrer"))}
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
            {hit ? <Flame className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {r.lift!.toFixed(1)}×
          </span>
        )}
        {!playing && r.number && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {r.number}
          </span>
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

      <p className="mt-2 line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-muted-foreground" title={r.caption ?? undefined}>
        {r.caption?.trim() || <span className="italic opacity-60">no caption</span>}
      </p>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="flex items-baseline gap-1 text-sm font-semibold tabular-nums">
          <Eye className="h-3.5 w-3.5 self-center text-muted-foreground" />
          {r.views != null ? nf.format(r.views) : "—"}
          {r.viewsDelta != null && r.viewsDelta !== 0 && (
            <span className={`text-[10px] font-medium ${r.viewsDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {r.viewsDelta > 0 ? "+" : ""}
              {nf.format(r.viewsDelta)}
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {r.postedAt ? new Date(r.postedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : ""}
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
