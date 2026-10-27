"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { decideTrialProposal } from "@/app/(app)/trials/actions";

/**
 * Above a trial that is not simply running: a proposal waiting for the
 * team's answer — the Telegram buttons land here with theirs preselected —
 * or a note on why it stopped or never ran.
 */
export function TrialStatus({
  trialId,
  status,
  note,
  replaces,
  staff,
  decide,
}: {
  trialId: string;
  status: string;
  note: string | null;
  replaces: { id: string; label: string; views: number | null } | null;
  staff: boolean;
  decide: "replace" | "keep" | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const nf = new Intl.NumberFormat("de-DE");

  const answer = (replace: boolean) =>
    start(async () => {
      const res = await decideTrialProposal(trialId, replace);
      if (res.error) return void toast.error(res.error);
      toast.success(replace ? "This reel runs the Trial-Maxxing now" : "Kept the running trial");
      router.replace(`/trials/${trialId}`);
      router.refresh();
    });

  if (status === "proposed") {
    return (
      <div className="mx-auto max-w-5xl rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
        <p className="text-sm font-semibold">Proposed: replace the running Trial-Maxxing on this account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {replaces ? (
            <>
              Running now:{" "}
              <Link href={`/trials/${replaces.id}`} className="underline">
                {replaces.label}
              </Link>
              {replaces.views != null && ` · ${nf.format(replaces.views)} plays`}.{" "}
            </>
          ) : null}
          What is already shot of it stays in editing and the vault and gets posted as normal reels.
        </p>
        {staff ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(true)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold ${
                decide === "keep" ? "border border-border bg-card" : "bg-emerald-500 text-white"
              }`}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}✅ Replace
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(false)}
              className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold ${
                decide === "keep" ? "bg-foreground text-background" : "border border-border bg-card"
              }`}
            >
              ✋ Keep current
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">A manager decides this.</p>
        )}
      </div>
    );
  }

  const text =
    status === "replaced"
      ? "Replaced by a bigger winner — no more reshoots here."
      : status === "dismissed"
        ? "Not running."
        : status === "archived"
          ? "Stopped."
          : null;
  if (!text) return null;
  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-border/50 bg-muted/30 px-4 py-3 text-sm">
      <span className="font-semibold">{text}</span>
      {note && <span className="ml-1.5 text-muted-foreground">{note}</span>}
    </div>
  );
}
