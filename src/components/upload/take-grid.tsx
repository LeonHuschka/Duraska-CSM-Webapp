"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Film, Loader2, Plus, X } from "lucide-react";
import { quickVideoFrame } from "@/lib/thumbnails";
import { resolveMime } from "@/lib/upload-takes";

/**
 * The takes as the model picks them: one card each with its picture, its
 * upload progress and the IG / Fansly switch, the last card adds more.
 * The upload page, the SHOOTING upload page and a Trial-Maxxing box all
 * draw it, so she finds the same thing wherever she uploads.
 */
export type GridTake = {
  id: string;
  file: File;
  fansly: boolean;
  status: "waiting" | "uploading" | "done" | "error";
  pct: number;
};

// Phones decode one video at a time well; several at once stall them all.
let thumbQueue: Promise<unknown> = Promise.resolve();
/** The frame each card grabbed, kept so a send can store it as the take's thumbnail. */
export const takeFrames = new WeakMap<File, Blob>();

/** What the model sees of a take: the photo itself, or a video's first frame grabbed onto a canvas. */
function TakeThumb({ file }: { file: File }) {
  // null while grabbing, "" when the frame could not be read
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    if (resolveMime(file).startsWith("image/")) {
      made = URL.createObjectURL(file);
      setUrl(made);
    } else {
      const job = thumbQueue.then(() => (cancelled ? null : quickVideoFrame(file)));
      thumbQueue = job.catch(() => null);
      job.then((blob) => {
        if (cancelled) return;
        if (!blob) return setUrl("");
        takeFrames.set(file, blob);
        made = URL.createObjectURL(blob);
        setUrl(made);
      });
    }
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file]);
  if (url === null) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!url) return <Film className="h-6 w-6 text-muted-foreground" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />;
}

export function TakeGrid<T extends GridTake>({
  takes,
  maxMb,
  disabled,
  dragOver,
  onAdd,
  onRemove,
  onRetry,
  onFansly,
}: {
  takes: T[];
  maxMb: number;
  disabled?: boolean;
  dragOver?: boolean;
  onAdd: () => void;
  onRemove: (t: T) => void;
  onRetry: (t: T) => void;
  onFansly: (t: T) => void;
}) {
  const maxBytes = maxMb * 1024 * 1024;
  const fanslyCount = takes.filter((t) => t.fansly).length;
  return (
    <>
      {takes.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Tap <span className="font-semibold text-foreground">IG</span> on every take you shot in a Fansly outfit — it
          turns <span className="font-semibold text-sky-300">Fansly</span>.
          {fanslyCount > 0 && <span className="ml-1 font-medium text-sky-300">{fanslyCount} Fansly</span>}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {takes.map((t, i) => {
          const tooBig = t.file.size > maxBytes;
          return (
            <div
              key={t.id}
              className={`relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-xl border-2 bg-muted/40 ${
                tooBig ? "border-red-500" : t.fansly ? "border-sky-400" : "border-transparent"
              }`}
            >
              <TakeThumb file={t.file} />
              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Take {i + 1}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(t)}
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {t.status === "done" ? (
                <span className="absolute bottom-10 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                </span>
              ) : t.status === "error" ? (
                <button
                  type="button"
                  onClick={() => onRetry(t)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white"
                >
                  <X className="h-7 w-7 text-red-400" />
                  <span className="px-2 text-center text-[10px] font-semibold">
                    {tooBig ? `Too large — max ${maxMb} MB` : "Failed — tap to retry"}
                  </span>
                </button>
              ) : (
                // Upload progress of the whole file, from the moment she picks it.
                <div className="absolute inset-x-1.5 bottom-10 rounded-md bg-black/60 px-1.5 py-1">
                  <div className="flex justify-between text-[9px] font-semibold tabular-nums text-white">
                    <span>{t.status === "waiting" ? "waiting" : "uploading"}</span>
                    <span>{t.pct}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${t.pct}%` }} />
                  </div>
                </div>
              )}
              {/* Instagram or Fansly: one tap per take, so the editor
                  can tell the Fansly-outfit takes apart. */}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onFansly(t)}
                className={`absolute inset-x-1.5 bottom-1.5 rounded-lg py-1.5 text-[11px] font-semibold backdrop-blur ${
                  t.fansly ? "bg-sky-500 text-white" : "bg-black/60 text-white/90"
                }`}
              >
                {t.fansly ? "Fansly" : "IG"}
              </button>
            </div>
          );
        })}
        {!disabled && (
          <button
            type="button"
            onClick={onAdd}
            className={`flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors ${
              dragOver ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/40"
            }`}
          >
            <Plus className="h-8 w-8" />
            {takes.length === 0 && <span className="text-[11px] font-medium">Add takes</span>}
          </button>
        )}
      </div>
    </>
  );
}
