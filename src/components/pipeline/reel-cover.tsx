"use client";

import { useState } from "react";

/**
 * A post's cover from the platform, or nothing at all.
 *
 * Goes through /api/cover because Meta's CDNs refuse the browser directly.
 * If even that fails the tile falls back to text rather than showing the
 * browser's broken-image glyph.
 */
export function ReelCover({
  src,
  href,
  fallback,
}: {
  src: string;
  href: string | null;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    const text = (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-muted-foreground">
        <span>{fallback}</span>
        {href && <span className="underline">open post ↗</span>}
      </div>
    );
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className="block h-full w-full">
        {text}
      </a>
    ) : (
      text
    );
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/cover?u=${encodeURIComponent(src)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="block h-full w-full">
      {img}
    </a>
  ) : (
    img
  );
}
