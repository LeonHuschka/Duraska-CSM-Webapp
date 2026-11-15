"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferenceVideo } from "@/lib/trials";

/**
 * The videos a box builds on, as a wheel: one big on top, the others small
 * below it, all playing. Tap a small one and it turns up into the big spot
 * with its sound; the rest move round behind it. The newest winner starts
 * on top — that is what she shoots from.
 */
export function ReferenceVideos({ videos }: { videos: ReferenceVideo[] }) {
  const [active, setActive] = useState(Math.max(0, videos.length - 1));
  const [tapped, setTapped] = useState(false);
  const big = useRef<HTMLVideoElement>(null);
  if (!videos.length) return null;

  // Round from the one on top, so the order turns like a wheel.
  const ring = videos.map((_, i) => videos[(active + i) % videos.length]);
  const [top, ...rest] = ring;

  return (
    <div className="space-y-3">
      <div key={top.key} className="relative animate-in fade-in zoom-in-95 slide-in-from-bottom-3 duration-300">
        <video
          ref={big}
          src={top.url}
          poster={top.poster ?? undefined}
          controls
          playsInline
          autoPlay={tapped}
          preload="metadata"
          className="max-h-[55dvh] w-full rounded-xl bg-black object-contain"
        />
        <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] rounded-xl border border-white/15 bg-black/55 px-2.5 py-1.5 backdrop-blur-md">
          <p className="text-xs font-semibold text-white">{top.title}</p>
          {top.sub && <p className="text-[11px] text-white/70">{top.sub}</p>}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="flex gap-2.5">
          {rest.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                setTapped(true);
                setActive(videos.indexOf(v));
              }}
              className="group w-24 shrink-0 text-left transition-transform duration-300 hover:-translate-y-0.5"
              title={`Show ${v.title} big`}
            >
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-white/15 bg-black">
                <video
                  src={`${v.url}#t=0.1`}
                  poster={v.poster ?? undefined}
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-80 transition-opacity group-hover:opacity-100">
                  <span className="rounded-full bg-black/50 p-1.5 backdrop-blur-sm">
                    <Play className="h-3.5 w-3.5 fill-white text-white" />
                  </span>
                </span>
              </div>
              <p className={cn("mt-1 truncate text-[11px] font-semibold")}>{v.title}</p>
              {v.sub && <p className="truncate text-[10px] text-muted-foreground">{v.sub}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
