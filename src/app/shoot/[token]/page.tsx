import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { readShootToken } from "@/lib/shoot-token";
import { notePlain } from "@/lib/shoot-list";
import { DIM_META, cellName, loadTrial, roundBrief, winnersOf } from "@/lib/trials";
import { ShootUpload } from "@/components/shoot/shoot-upload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Upload takes", robots: { index: false, follow: false } };

/**
 * One inspo link to shoot, opened from its button in SHOOTING: the inspo
 * to watch, the notes, and the takes to add. Everything else about the
 * job — title, link, brief — is filled in on send.
 */
export default async function ShootPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = readShootToken(token);
  if (!target) notFound();
  const db = createAdminClient();
  if (target.kind === "cell") return <CellPage token={token} cellId={target.id} />;
  const { data: link } = await db
    .from("content_links")
    .select("id, url, note, status, posted_at, request_id, video_path")
    .eq("id", target.id)
    .maybeSingle();
  if (!link) notFound();

  const [{ data: video }, { data: job }] = await Promise.all([
    link.video_path
      ? db.storage.from("content-assets").createSignedUrl(link.video_path, 6 * 3600)
      : Promise.resolve({ data: null }),
    link.request_id
      ? db.from("content_requests").select("title").eq("id", link.request_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { count } = link.request_id
    ? await db
        .from("content_assets")
        .select("id", { count: "exact", head: true })
        .eq("request_id", link.request_id)
        .eq("stage", "raw")
        .is("deleted_at", null)
    : { count: 0 };

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-background px-4 pb-16 pt-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">🎬 To shoot</p>
        <h1 className="mt-1 text-xl font-semibold">
          {job?.title ? `${job.title} — add more takes` : "Upload the takes of this reel"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Requested {new Date(link.posted_at).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
          {job?.title && ` · ${count ?? 0} take${count === 1 ? "" : "s"} in so far`}
        </p>
      </div>

      {video?.signedUrl ? (
        <video
          src={video.signedUrl}
          controls
          playsInline
          preload="metadata"
          className="max-h-[55dvh] w-full rounded-xl bg-black object-contain"
        />
      ) : null}
      <a href={link.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-primary underline underline-offset-2">
        {video?.signedUrl ? "Open the inspo on Instagram" : link.url}
      </a>

      <div className="rounded-xl border border-border/50 bg-card p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{notePlain(link.note) || "—"}</p>
      </div>

      {link.status === "dead" ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm">This inspo is gone from Instagram — nothing to shoot.</p>
      ) : (
        <ShootUpload token={token} existingTitle={job?.title ?? null} />
      )}
    </main>
  );
}

/** A Trial-Maxxing box: the outlier, what this round changes, and the takes. */
async function CellPage({ token, cellId }: { token: string; cellId: string }) {
  const db = createAdminClient();
  const { data: row } = await db.from("trial_cells").select("trial_id").eq("id", cellId).maybeSingle();
  const view = row ? await loadTrial(db, row.trial_id) : null;
  const cell = view?.cells.find((c) => c.id === cellId);
  if (!view || !cell) notFound();
  const running = view.status === "active" && view.phase === cell.dimension;
  const brief = roundBrief(cell.dimension, winnersOf(view), view.reshoots);

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-background px-4 pb-16 pt-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          🧪 Trial-Maxxing{view.account ? ` · ${view.account.label}` : ""}
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {DIM_META[cell.dimension].emoji} {cellName(cell)}
          {cell.title ? ` — ${cell.title}` : ""}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Round {DIM_META[cell.dimension].round} · {cell.takes} take{cell.takes === 1 ? "" : "s"} in so far
          {cell.state !== "empty" && cell.state !== "takes" ? " · with the editor" : ""}
        </p>
      </div>

      {view.video ? (
        <video src={view.video} controls playsInline preload="metadata" className="max-h-[55dvh] w-full rounded-xl bg-black object-contain" />
      ) : null}
      {view.postUrl && (
        <a href={view.postUrl} target="_blank" rel="noreferrer" className="block truncate text-sm text-primary underline underline-offset-2">
          Open the outlier on Instagram
        </a>
      )}

      <div className="rounded-xl border border-border/50 bg-card p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This round</p>
        <p className="mt-1 text-sm">{brief}</p>
      </div>

      {running ? (
        <ShootUpload token={token} existingTitle={cell.title} />
      ) : (
        <p className="rounded-xl border border-border/50 bg-card p-3 text-sm">This round is over — nothing more to shoot for this box.</p>
      )}
    </main>
  );
}
