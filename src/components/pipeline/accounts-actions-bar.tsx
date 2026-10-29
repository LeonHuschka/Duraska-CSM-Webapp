"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addPostingAccount, scrapeAccountsNow } from "@/components/pipeline/actions";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "fansly", label: "Fansly" },
  { value: "other", label: "Other" },
];

/**
 * Today's numbers without waiting for the morning run, and the way to
 * Research & Pattern. Adding an account is the last tile in the grid.
 */
export function AccountsActionsBar() {
  const router = useRouter();
  const [scraping, startScrape] = useTransition();

  function scrapeNow() {
    startScrape(async () => {
      const res = await scrapeAccountsNow();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const s = res.summary!;
      toast.success(
        `${s.accounts} accounts read · ${s.posts} posts · ${s.matched} matched · ~$${s.estimatedUsd.toFixed(3)}`,
        { description: s.notes.length ? s.notes.join(" · ") : undefined, duration: 8000 }
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a
        href="/research"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Research &amp; Pattern
      </a>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={scrapeNow} disabled={scraping}>
        {scraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {scraping ? "Reading accounts…" : "Scrape now"}
      </Button>
    </div>
  );
}

/** The form behind the plus tile. */
export function AddAccountDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [manager, setManager] = useState("");
  const [saving, startSave] = useTransition();

  function save() {
    if (!handle.trim()) {
      toast.error("Enter a handle or page URL");
      return;
    }
    startSave(async () => {
      const res = await addPostingAccount({ platform, handle, manager });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const name = handle.trim();
      setHandle("");
      setManager("");
      setOpen(false);
      router.refresh();
      // Read it straight away, so the tile has followers, reels and a
      // picture instead of waiting for tomorrow morning's run.
      if (res.id) {
        const id = toast.loading(`Added ${name} — reading it for the first time…`);
        fetch(`/api/accounts/scrape?account=${res.id}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((j) => {
            const s = j?.summary;
            if (!j?.ok || !s) throw new Error(j?.error ?? "the first read failed");
            toast.success(`${name}: ${s.posts} reels read`, {
              id,
              description: s.notes?.length ? s.notes.join(" · ") : undefined,
              duration: 8000,
            });
          })
          .catch((e) => toast.error(`${name}: ${e instanceof Error ? e.message : "the first read failed"}`, { id }))
          .finally(() => router.refresh());
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a posting account</DialogTitle>
            <DialogDescription>
              Instagram takes the username. Facebook takes the page&apos;s name or its full
              URL — a page without a name, like facebook.com/people/…/6159…, needs the URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Platform</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {platform === "facebook" ? "Page name or URL" : "Handle"}
              </label>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder={platform === "facebook" ? "https://www.facebook.com/…" : "@handle"}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Managed by (Telegram username)
              </label>
              <Input
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                placeholder="@username"
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <p className="text-[11px] text-muted-foreground">
                Ties the account to the VA who posts on it — the vault shows her only her own.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !handle.trim()}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
