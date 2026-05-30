import { cn } from "@/lib/utils";

/**
 * TRIAL REEL badge — Telegram-style mint-gradient circle with a bold
 * black "?" in the middle and a dark green ring. Used wherever a
 * content_request is shown (vault card, schedule slot, request card,
 * request detail) so the poster sees at a glance that the output must
 * be posted as a trial reel rather than a normal post.
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
  const px = { sm: 14, md: 18, lg: 24 }[size];

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title="Trial Reel — must be posted as a trial"
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-label="Trial reel"
      >
        <defs>
          <radialGradient
            id="trialBadgeGrad"
            cx="38%"
            cy="32%"
            r="70%"
            fx="38%"
            fy="32%"
          >
            <stop offset="0%" stopColor="#d6f5e3" />
            <stop offset="55%" stopColor="#8edbb1" />
            <stop offset="100%" stopColor="#4ea884" />
          </radialGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="url(#trialBadgeGrad)"
          stroke="#234538"
          strokeWidth="4"
        />
        <text
          x="50"
          y="73"
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize="65"
          fontWeight="900"
          fill="#000"
        >
          ?
        </text>
      </svg>
      {withLabel && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
          Trial
        </span>
      )}
    </span>
  );
}
