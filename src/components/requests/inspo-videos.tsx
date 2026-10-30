"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { quickVideoFrame } from "@/lib/thumbnails";

const VIDEO = "aspect-[9/16] w-36 rounded-xl border border-border/50 bg-black object-cover sm:w-44";

/** A stored reel with its first frame as poster — a paused video shows black. */
export function PosterVideo({ url, label }: { url: string; label: string }) {
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let gone = false;
    quickVideoFrame(url, 25_000).then((blob) => {
      if (!blob || gone) return;
      made = URL.createObjectURL(blob);
      setPoster(made);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return (
    <div className="shrink-0">
      <video src={url} poster={poster ?? undefined} controls playsInline preload="metadata" className={VIDEO} />
      <p className="mt-1 text-center text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The inspo a trial's viral reel was shot from, when nobody has given it
 * yet: paste the link once and every job of the trial shows it.
 */
export function TrialInspoSlot({ trialId, link }: { trialId: string; link: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(link ?? "");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trials/inspo?id=${trialId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link: value.trim() }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; note?: string };
      if (!out.ok) toast.error(`Could not fetch it: ${out.note ?? res.status}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shrink-0">
      <div className={`${VIDEO} flex flex-col justify-center gap-2 bg-muted/20 p-3`}>
        <p className="text-center text-[11px] text-muted-foreground">
          {link ? "The video could not be fetched — try again or paste another link" : "Paste the original inspo link"}
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder="instagram.com/reel/…"
          className="h-8 w-full rounded-md border border-border/50 bg-background px-2 text-xs outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !value.trim()}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Fetching…" : "Add"}
        </button>
      </div>
      <p className="mt-1 text-center text-[10px] text-muted-foreground">Original inspo</p>
    </div>
  );
}
