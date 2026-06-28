"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Flame, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createAccount } from "@/app/(app)/warmup/actions";
import { WARMUP_DURATION_DAYS, type WarmupPlatform } from "@/lib/warmup-spec";
import type { AccountSummary } from "@/app/(app)/warmup/page";

const PLATFORM_META: Record<
  string,
  { label: string; dot: string; chip: string }
> = {
  facebook: { label: "Facebook", dot: "bg-blue-500", chip: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  instagram: { label: "Instagram", dot: "bg-pink-500", chip: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
};

const STATUS_META: Record<string, { label: string; chip: string }> = {
  warmup: { label: "Warming up", chip: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  graduated: { label: "Graduated", chip: "bg-green-500/15 text-green-400 border-green-500/30" },
  paused: { label: "Paused", chip: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  dead: { label: "Dead", chip: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export function WarmupView({ accounts }: { accounts: AccountSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<WarmupPlatform>("facebook");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!handle.trim()) {
      toast.error("Handle is required");
      return;
    }
    setCreating(true);
    const res = await createAccount({
      platform,
      handle: handle.trim(),
      display_name: displayName.trim() || undefined,
    });
    setCreating(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`Account @${handle.trim()} created — ${WARMUP_DURATION_DAYS}-day plan generated`);
    setHandle("");
    setDisplayName("");
    setOpen(false);
    if (res.account_id) router.push(`/warmup/${res.account_id}`);
  }

  const active = accounts.filter((a) => a.status === "warmup");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Flame className="h-6 w-6 text-amber-400" />
            Account Warm-Up
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New accounts prove themselves here before joining the rotation.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New warm-up account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["facebook", "instagram"] as WarmupPlatform[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        platform === p
                          ? PLATFORM_META[p].chip
                          : "border-border/50 text-muted-foreground hover:bg-accent/30"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${PLATFORM_META[p].dot}`} />
                      {PLATFORM_META[p].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="handle">Handle / Username</Label>
                <Input
                  id="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="e.g. julia.summer"
                  disabled={creating}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dn">Display Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="dn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Julia"
                  disabled={creating}
                />
              </div>
              <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                A full {WARMUP_DURATION_DAYS}-day warm-up plan (profile setup → daily
                photos → reel ramp 1→10) is generated automatically.
              </p>
              <Button onClick={handleCreate} disabled={creating || !handle.trim()} className="w-full">
                {creating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</>
                ) : (
                  "Create account + generate plan"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Empty state */}
      {accounts.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
          <div className="rounded-xl bg-amber-500/10 p-3">
            <Flame className="h-6 w-6 text-amber-400" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No accounts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a Facebook or Instagram account to start its warm-up plan.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const pm = PLATFORM_META[a.platform] ?? { label: a.platform, dot: "bg-gray-500", chip: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
            const sm = STATUS_META[a.status] ?? STATUS_META.warmup;
            const pct = a.totalSlots > 0 ? Math.round((a.postedSlots / a.totalSlots) * 100) : 0;
            return (
              <Link
                key={a.id}
                href={`/warmup/${a.id}`}
                className="group flex flex-col gap-3 rounded-xl border border-border/40 bg-card p-4 transition-all hover:border-border/70 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
                      <span className="truncate font-medium">@{a.handle}</span>
                    </div>
                    {a.display_name && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {a.display_name}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${sm.chip}`}>
                    {sm.label}
                  </span>
                </div>

                {/* Progress */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Day {a.currentDay} / {WARMUP_DURATION_DAYS}</span>
                    <span>{a.postedSlots}/{a.totalSlots} posted</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Today's status */}
                <div className="flex items-center gap-3 text-[11px]">
                  {a.dueToday > 0 ? (
                    <span className="flex items-center gap-1 text-amber-400">
                      <Flame className="h-3 w-3" /> {a.dueToday} due today
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 className="h-3 w-3" /> Today done
                    </span>
                  )}
                  {a.overdue > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertTriangle className="h-3 w-3" /> {a.overdue} overdue
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">
          {active.length} account{active.length > 1 ? "s" : ""} warming up
        </p>
      )}
    </div>
  );
}
