"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Starts a run; while one is going the page reads itself again every few
 * seconds, so the counts move without anyone reloading.
 */
export function RunAnalysisButton({ personaId, running }: { personaId: string; running: boolean }) {
  const router = useRouter();
  const [starting, start] = useTransition();

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [running, router]);

  function run() {
    start(async () => {
      const res = await fetch(`/api/analysis?persona=${personaId}`, { method: "POST" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as {
        error?: string;
        already?: string;
        resumed?: string;
        counts?: Record<string, number>;
      } | null;
      if (!res?.ok) {
        toast.error(body?.error ?? "Could not start the analysis");
        return;
      }
      if (body?.already) toast.message("A run is already going");
      else if (body?.resumed) toast.success("Picked the run up again");
      else if (body?.counts)
        toast.success(
          `${body.counts.winners} winners · ${body.counts.losers} losers · ${body.counts.controls} control · ${body.counts.added} new to watch`
        );
      router.refresh();
    });
  }

  return (
    <Button size="sm" className="gap-1.5" onClick={run} disabled={starting || running}>
      {starting || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {running ? "Running…" : "Run analysis"}
    </Button>
  );
}
