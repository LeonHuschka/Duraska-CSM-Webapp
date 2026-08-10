"use client";

import { useState } from "react";
import {
  readScreenshot,
  identifyTiles,
  type TileResult,
} from "@/app/(app)/settings/screenshot-test/actions";

type Head = Awaited<ReturnType<typeof readScreenshot>>;

// Three tiles per call. Landmark matching costs about half a second per
// candidate against a shortlist of twelve, so this leaves plenty of room
// inside the minute a function gets — the whole screenshot at once is what
// timed the page out.
const BATCH = 3;

/**
 * Drop a screenshot in, see exactly what the bot would make of it.
 *
 * Every VA screenshots a different surface — the app's own profile grid,
 * Meta's business library, whatever the next hire uses — and none of that is
 * ours to standardise. So the answer isn't a fixed layout, it's being able
 * to check any layout in ten seconds.
 */
export function ScreenshotTest() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [head, setHead] = useState<Head | null>(null);
  const [rows, setRows] = useState<TileResult[]>([]);
  const [pool, setPool] = useState<{ hash: number; landmarks: number; text: number } | null>(null);
  const [by, setBy] = useState({ landmarks: 0, image: 0, text: 0 });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setHead(null);
    setRows([]);
    setPool(null);
    setBy({ landmarks: 0, image: 0, text: 0 });
    try {
      setStep("Reading the screenshot…");
      const read = await readScreenshot(form);
      if (read.error || !read.tiles) {
        setError(read.error ?? "nothing was read");
        return;
      }
      setHead(read);

      // Results appear batch by batch rather than all at the end, so a slow
      // run still shows what it has.
      let taken: string[] = [];
      for (let i = 0; i < read.tiles.length; i += BATCH) {
        const slice = read.tiles.slice(i, i + BATCH);
        setStep(`Identifying tiles ${i + 1}–${i + slice.length} of ${read.tiles.length}…`);
        const res = await identifyTiles({ tiles: slice, taken });
        taken = res.taken;
        const views = new Map(slice.map((t) => [t.position, t.views]));
        setRows((r) => [
          ...r,
          ...res.tiles.map((t) => ({ ...t, views: views.get(t.position) ?? null })),
        ]);
        setPool({ hash: res.poolSize, landmarks: res.landmarkPool, text: res.textPoolSize });
        setBy((b) => ({
          landmarks: b.landmarks + res.byMethod.landmarks,
          image: b.image + res.byMethod.image,
          text: b.text + res.byMethod.text,
        }));
      }
      setStep("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="image"
          accept="image/*"
          required
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/15 file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Working…" : "Analyse"}
        </button>
        {step && <span className="text-xs text-muted-foreground">{step}</span>}
      </form>

      {error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {head && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            read as <span className="text-foreground">{head.kind}</span>
          </span>
          {head.handle && (
            <span>
              handle <span className="text-foreground">@{head.handle}</span>
            </span>
          )}
          {head.followers != null && (
            <span>
              followers <span className="text-foreground">{head.followers}</span>
            </span>
          )}
          <span>
            confidence{" "}
            <span className="text-foreground">{(head.confidence ?? 0).toFixed(2)}</span>
          </span>
          {pool && (
            <span>
              against <span className="text-foreground">{pool.hash}</span> cuts,{" "}
              <span className="text-foreground">{pool.landmarks}</span> with landmarks,{" "}
              <span className="text-foreground">{pool.text}</span> with text
            </span>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.filter((t) => t.match).length} of {rows.length} tiles identified
            {head?.tiles && rows.length < head.tiles.length && " so far"}
            {" — "}
            {by.landmarks} by landmarks, {by.image} by picture, {by.text} by text
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((t) => (
              <Tile key={t.position} t={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ t }: { t: TileResult }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <div className="flex items-start justify-between text-xs">
        <span className="font-medium">Tile {t.position}</span>
        <span className="tabular-nums text-muted-foreground">
          ▶ {t.views ?? "—"}
        </span>
      </div>

      <div className="mt-2 flex gap-2">
        <Shot src={t.crop} label="cut out" />
        <Shot src={t.match?.thumb ?? null} label="in the vault" />
      </div>

      <div className="mt-2 text-xs">
        {t.match ? (
          <>
            <p className="truncate font-medium text-emerald-400">{t.match.title}</p>
            <p className="text-muted-foreground">{t.match.explain}</p>
            {t.match.method === "text" && (
              <p className="mt-1 text-[10px] leading-tight text-muted-foreground/70">
                read “{t.match.tileText}” · stored “{t.match.cutText}”
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium text-amber-400">not identified</p>
            <p className="text-muted-foreground">
              {t.box
                ? t.nearest
                  ? `closest was ${t.nearest.distance} bits at ${(
                      t.nearest.ratio * 100
                    ).toFixed(0)}% of the runner-up — not decisive`
                  : "no clear picture or text match"
                : "the model gave no position for this tile"}
            </p>
          </>
        )}
        {!t.match && t.closest.length > 0 && (
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground/70">
            closest:{" "}
            {t.closest.map((c) => `${c.title} (${c.distance})`).join(", ")}
          </p>
        )}
        {t.caption && (
          <p className="mt-1 line-clamp-2 text-muted-foreground/70">
            text on tile: {t.caption}
          </p>
        )}
      </div>
    </div>
  );
}

function Shot({ src, label }: { src: string | null; label: string }) {
  return (
    <div className="flex-1">
      <div className="aspect-[9/16] overflow-hidden rounded-lg border border-border/40 bg-muted/30">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            —
          </div>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
