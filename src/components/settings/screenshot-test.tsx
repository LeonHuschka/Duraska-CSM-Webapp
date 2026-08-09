"use client";

import { useState } from "react";
import { analyseScreenshot, type TileResult } from "@/app/(app)/settings/screenshot-test/actions";

type Result = Awaited<ReturnType<typeof analyseScreenshot>>;

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
  const [res, setRes] = useState<Result | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setRes(null);
    try {
      setRes(await analyseScreenshot(form));
    } catch (err) {
      setRes({ error: err instanceof Error ? err.message : "failed" });
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
          {busy ? "Reading…" : "Analyse"}
        </button>
      </form>

      {res?.error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {res.error}
        </p>
      )}

      {res && !res.error && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>
              read as <span className="text-foreground">{res.kind}</span>
            </span>
            {res.handle && (
              <span>
                handle <span className="text-foreground">@{res.handle}</span>
              </span>
            )}
            {res.followers != null && (
              <span>
                followers <span className="text-foreground">{res.followers}</span>
              </span>
            )}
            <span>
              confidence{" "}
              <span className="text-foreground">
                {(res.confidence ?? 0).toFixed(2)}
              </span>
            </span>
            <span>
              compared against{" "}
              <span className="text-foreground">{res.poolSize}</span> hashed cuts,{" "}
              <span className="text-foreground">{res.textPoolSize}</span> with text
            </span>
          </div>

          {res.tiles && res.tiles.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                {res.tiles.filter((t) => t.match).length} of {res.tiles.length}{" "}
                tiles identified
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {res.tiles.map((t) => (
                  <Tile key={t.position} t={t} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reel tiles were found in this image.
            </p>
          )}
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
            <p className="text-muted-foreground">
              {t.match.method === "image"
                ? `by picture — ${t.match.score} bits apart, ${(
                    (t.match.ratio ?? 0) * 100
                  ).toFixed(0)}% of the runner-up`
                : t.match.method === "text"
                  ? `by text — ${(t.match.score * 100).toFixed(0)}% alike`
                  : `by looking — ${(t.match.score * 100).toFixed(0)}% sure`}
            </p>
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
