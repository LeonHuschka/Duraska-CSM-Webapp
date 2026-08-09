"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { generateFrameSheet, framesPathFor } from "@/lib/thumbnails";
import { cutsNeedingFrames, saveFrames, framesProgress } from "@/app/(app)/settings/frames/actions";

type Row = { name: string; state: "ok" | "skipped" | "failed"; note?: string };

/**
 * Give every finished cut a strip of stills.
 *
 * This runs in the browser on purpose: the video has to be decoded to take
 * frames from it, and it is already decoded here. Doing it server-side would
 * mean fetching all of them, and moving those files is the one thing in this
 * system that costs real money.
 *
 * It is therefore a one-off with a visible price — roughly the size of the
 * vault, downloaded once — which is why it is a button someone presses and
 * watches, not something that happens quietly.
 */
export function FramesBackfill({
  initial,
}: {
  initial: { total: number; withFrames: number; hashed: number };
}) {
  const [running, setRunning] = useState(false);
  const [stop, setStop] = useState(false);
  const [done, setDone] = useState(0);
  const [todo, setTodo] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [log, setLog] = useState<Row[]>([]);
  const [stats, setStats] = useState(initial);

  async function run() {
    setRunning(true);
    setStop(false);
    setLog([]);
    setDone(0);
    setBytes(0);

    const supabase = createClient();
    const { cuts, error } = await cutsNeedingFrames();
    if (error) {
      setLog([{ name: "—", state: "failed", note: error }]);
      setRunning(false);
      return;
    }
    setTodo(cuts.length);

    for (const cut of cuts) {
      if (stop) break;
      try {
        const sheet = await generateFrameSheet(cut.url, cut.mime);
        if (!sheet) {
          setLog((l) => [...l, { name: cut.name, state: "skipped", note: "no frames" }]);
          setDone((d) => d + 1);
          continue;
        }
        const path = framesPathFor(cut.path);
        const { error: upErr } = await supabase.storage
          .from("content-assets")
          .upload(path, sheet.blob, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw new Error(upErr.message);

        const { error: saveErr } = await saveFrames(cut.id, path, sheet.count);
        if (saveErr) throw new Error(saveErr);

        setBytes((b) => b + sheet.blob.size);
        setLog((l) => [...l, { name: cut.name, state: "ok" }]);
      } catch (err) {
        setLog((l) => [
          ...l,
          { name: cut.name, state: "failed", note: err instanceof Error ? err.message : "failed" },
        ]);
      }
      setDone((d) => d + 1);
    }

    setStats(await framesProgress());
    setRunning(false);
  }

  const failed = log.filter((r) => r.state === "failed").length;
  const skipped = log.filter((r) => r.state === "skipped").length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Finished cuts" value={stats.total} />
        <Stat label="With a strip of stills" value={stats.withFrames} />
        <Stat label="Fingerprinted from it" value={stats.hashed} hint="filled in by the scheduled job" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? `Working… ${done}/${todo}` : "Take the stills"}
        </button>
        {running && (
          <button
            onClick={() => setStop(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            Stop after this one
          </button>
        )}
        {(running || log.length > 0) && (
          <span className="text-xs text-muted-foreground">
            {(bytes / 1024 / 1024).toFixed(1)} MB of strips written
            {failed > 0 && <span className="text-rose-300"> · {failed} failed</span>}
            {skipped > 0 && <span className="text-amber-300"> · {skipped} skipped</span>}
          </span>
        )}
      </div>

      {running && (
        <p className="text-xs text-muted-foreground">
          Each video is downloaded once to take stills from it, so leave this
          tab open and on screen — a background tab is throttled and will
          crawl.
        </p>
      )}

      {log.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border/50">
          {log.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-border/30 px-3 py-1.5 text-xs last:border-0"
            >
              <span className="truncate">{r.name}</span>
              <span
                className={
                  r.state === "ok"
                    ? "text-emerald-400"
                    : r.state === "skipped"
                      ? "text-amber-400"
                      : "text-rose-400"
                }
              >
                {r.state === "ok" ? "done" : (r.note ?? r.state)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs font-medium">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
