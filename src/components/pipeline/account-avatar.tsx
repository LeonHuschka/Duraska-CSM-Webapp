/* eslint-disable @next/next/no-img-element */

/**
 * An account as a face: its profile picture in a circle, the platform's
 * own logo pinned to the corner. Without a stored picture, the first
 * letter of the handle on the account's colour.
 */
export function PlatformLogo({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  if (platform === "instagram" || platform === "facebook") {
    return <img src={`/brand/${platform}.svg`} alt={platform} className={className} draggable={false} />;
  }
  return (
    <span className={`${className} inline-flex items-center justify-center rounded-full bg-muted text-[8px] font-bold uppercase`}>
      {platform.slice(0, 1)}
    </span>
  );
}

export function AccountAvatar({
  src,
  platform,
  label,
  size = 32,
  color,
  badge = true,
  className = "",
}: {
  src: string | null;
  platform: string;
  label: string;
  size?: number;
  /** The account's colour, drawn as a ring. */
  color?: string;
  badge?: boolean;
  className?: string;
}) {
  const initial = label.replace(/^@/, "").slice(0, 1).toUpperCase() || "?";
  const ring = color ? Math.max(1.5, size / 16) : 0;
  const logo = Math.max(10, Math.round(size * 0.42));
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} title={label}>
      <span
        className="block h-full w-full overflow-hidden rounded-full bg-muted"
        style={color ? { boxShadow: `0 0 0 ${ring}px ${color}` } : undefined}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-semibold text-white"
            style={{ background: color ?? "#52525b", fontSize: size * 0.42 }}
          >
            {initial}
          </span>
        )}
      </span>
      {badge && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-background p-[1.5px]"
          style={{ width: logo + 3, height: logo + 3 }}
        >
          <PlatformLogo platform={platform} className="h-full w-full" />
        </span>
      )}
    </span>
  );
}
