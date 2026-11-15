"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Volume2, VolumeX } from "lucide-react";
import type { ReferenceVideo } from "@/lib/trials";

/**
 * The videos a box builds on, as a wheel: one big on top, the others small
 * below it, all playing on a loop like reels — no player chrome, no black
 * bars. Tap a small one and it turns up into the big spot; the rest move
 * round behind it. The big one has a sound button; a tap on it pauses.
 * The newest winner starts on top — that is what she shoots from.
 */
export function ReferenceVideos({ videos }: { videos: ReferenceVideo[] }) {
  const [active, setActive] = useState(Math.max(0, videos.length - 1));
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const big = useRef<HTMLVideoElement>(null);
  // A new video on top plays from the start, with the sound as it was set.
  useEffect(() => {
    const v = big.current;
    if (!v) return;
    v.muted = muted;
    v.play().then(() => setPaused(false)).catch(() => {
      // Sound before any tap is blocked: fall back to silent and go on.
      v.muted = true;
      setMuted(true);
      v.play().catch(() => setPaused(true));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  if (!videos.length) return null;

  // Round from the one on top, so the order turns like a wheel.
  const ring = videos.map((_, i) => videos[(active + i) % videos.length]);
  const [top, ...rest] = ring;

  return (
    <div className="space-y-3">
      <div
        key={top.key}
        className="relative mx-auto aspect-[9/16] h-[62dvh] max-w-full overflow-hidden rounded-2xl bg-black animate-in fade-in zoom-in-95 slide-in-from-bottom-3 duration-300"
      >
        <video
          ref={big}
          src={top.url}
          poster={top.poster ?? undefined}
          muted={muted}
          autoPlay
          loop
          playsInline
          preload="auto"
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) v.play().then(() => setPaused(false)).catch(() => {});
            else {
              v.pause();
              setPaused(true);
            }
          }}
          className="h-full w-full cursor-pointer object-cover"
        />
        <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] rounded-xl border border-white/15 bg-black/45 px-2.5 py-1.5 backdrop-blur-md">
          <p className="text-xs font-semibold text-white">{top.title}</p>
          {top.sub && <p className="text-[11px] text-white/70">{top.sub}</p>}
        </div>
        {paused && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/45 p-3 backdrop-blur-md">
              <Pause className="h-6 w-6 fill-white text-white" />
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (big.current) {
              big.current.muted = next;
              if (!next && big.current.paused) big.current.play().then(() => setPaused(false)).catch(() => {});
            }
          }}
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md"
          aria-label={muted ? "Sound on" : "Sound off"}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {rest.length > 0 && (
        <div className="flex gap-2.5">
          {rest.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setActive(videos.indexOf(v))}
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
              </div>
              <p className="mt-1 truncate text-[11px] font-semibold">{v.title}</p>
              {v.sub && <p className="truncate text-[10px] text-muted-foreground">{v.sub}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
