"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPostingAccount,
  deletePostingAccount,
} from "@/app/(app)/settings/accounts/actions";
import type { RegisteredAccount } from "@/app/(app)/settings/accounts/page";

const PLATFORMS = [
  { value: "instagram", label: "Instagram", dot: "bg-pink-500" },
  { value: "facebook", label: "Facebook", dot: "bg-blue-600" },
  { value: "tiktok", label: "TikTok", dot: "bg-slate-400" },
  { value: "x", label: "X", dot: "bg-neutral-300" },
];

export function AccountsManager({ accounts }: { accounts: RegisteredAccount[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd() {
    if (!handle.trim()) {
      toast.error("Enter a handle");
      return;
    }
    setCreating(true);
    const res = await createPostingAccount({ platform, handle });
    setCreating(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`Added @${handle.trim().replace(/^@/, "")}`);
    setHandle("");
    router.refresh();
  }

  async function handleDelete(id: string, h: string) {
    setDeletingId(id);
    const res = await deletePostingAccount(id);
    setDeletingId(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success(`Removed @${h}`);
      router.refresh();
    }
  }

  // Group by platform for display
  const grouped = PLATFORMS.map((p) => ({
    ...p,
    accounts: accounts.filter((a) => a.platform === p.value),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <h2 className="text-sm font-medium">Add posting account</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Register the accounts you post to. When a VA marks a reel posted in the
          Vault, they pick the account here.
        </p>

        <div className="mt-4 space-y-3">
          {/* Platform picker */}
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  platform === p.value
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/50 text-muted-foreground hover:bg-accent/30"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                {p.label}
              </button>
            ))}
          </div>

          {/* Handle + add */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="handle"
                className="h-10 pl-9"
                disabled={creating}
              />
            </div>
            <Button onClick={handleAdd} disabled={creating || !handle.trim()} className="h-10 gap-1.5">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/50 p-8 text-center">
          <div className="rounded-xl bg-primary/10 p-3">
            <AtSign className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No accounts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the Instagram / Facebook / TikTok / X accounts you post to.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.value}>
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 rounded-full ${g.dot}`} />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h3>
                <span className="text-[11px] text-muted-foreground/60">
                  {g.accounts.length}
                </span>
              </div>
              <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/40 bg-card">
                {g.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-medium">@{a.handle}</span>
                    <button
                      onClick={() => handleDelete(a.id, a.handle)}
                      disabled={deletingId === a.id}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      title="Remove account"
                    >
                      {deletingId === a.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
