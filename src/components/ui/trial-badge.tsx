import { cn } from "@/lib/utils";

/**
 * TRIAL REEL badge — Telegram-style turquoise circle with a bold black "?"
 * in the middle. Used wherever a content_request is shown (vault card,
 * schedule slot, request card, request detail) so the poster sees at a
 * glance that the output must be posted as a trial reel.
 */
export function TrialBadge({
  className,
  size = "md",
  withLabel = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  withLabel?: boolean;
}) {
  const dims = {
    sm: "h-4 w-4 text-[9px]",
    md: "h-5 w-5 text-[11px]",
    lg: "h-6 w-6 text-[13px]",
  }[size];

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title="Trial Reel — must be posted as a trial"
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-cyan-400 font-black leading-none text-black ring-1 ring-cyan-300/50",
          dims
        )}
      >
        ?
      </span>
      {withLabel && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
          Trial
        </span>
      )}
    </span>
  );
}
