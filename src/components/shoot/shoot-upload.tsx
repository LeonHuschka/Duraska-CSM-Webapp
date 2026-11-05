"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { shootSend, shootUploadUrls } from "@/app/shoot/[token]/actions";
import { MAX_UPLOAD_MB, isMediaFile, putWithProgress, resolveMime } from "@/lib/upload-takes";
import { TakeGrid, takeFrames, type GridTake } from "@/components/upload/take-grid";

type Take = GridTake & { path: string | null; thumbPath: string | null; thumbUrl: string | null };

const CONCURRENCY = 3;
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * The takes of one reel, from the phone straight into storage, then one
 * tap to make the job. The same cards as the upload page — SFW / NSFW,
 * IG / Fansly per take — but nothing to type: she came here from Telegram
 * and the link and notes are already known.
 */
export function ShootUpload({
  token,
  existingTitle,
  askNsfw = true,
}: {
  token: string;
  existingTitle: string | null;
  /** Off for a trial box — its job is the trial's. */
  askNsfw?: boolean;
}) {
  const [takes, setTakes] = useState<Take[]>([]);
  const [isNsfw, setIsNsfw] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sent, setSent] = useState<{ title: string | null; count: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const patch = (id: string, p: Partial<Take>) => setTakes((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const busy = takes.some((t) => t.status === "uploading" || t.status === "waiting");
  const done = takes.filter((t) => t.status === "done");

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function upload(list: Take[]) {
    const res = await shootUploadUrls(token, list.map((t) => t.file.name));
    if (res.error || res.items.length !== list.length) {
      list.forEach((t) => patch(t.id, { status: "error" }));
      return void toast.error(res.error ?? "Could not start the upload");
    }
    const queue = list.map((t, i) => ({ t, slot: res.items[i] }));
    const lane = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const { t, slot } = next;
        patch(t.id, { status: "uploading", pct: 0, path: slot.path, thumbPath: slot.thumbPath, thumbUrl: slot.thumbUrl });
        try {
          await putWithProgress(slot.url, t.file, resolveMime(t.file), (loaded) =>
            patch(t.id, { pct: Math.round((loaded / (t.file.size || 1)) * 100) })
          );
          patch(t.id, { status: "done", pct: 100 });
        } catch (err) {
          patch(t.id, { status: "error" });
          toast.error(`A take did not upload: ${err instanceof Error ? err.message : "upload failed"} — tap it to try again`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  }

  function add(files: FileList | File[] | null) {
    const picked = Array.from(files ?? []).filter(isMediaFile);
    if (!picked.length) return void toast.error("Those files aren't photos or videos");
    if (picked.some((f) => f.size > MAX_BYTES)) {
      toast.error(`Take(s) over the ${MAX_UPLOAD_MB} MB limit — send those via Telegram`, { duration: 8000 });
    }
    const fresh: Take[] = picked.map((file) => ({
      id: crypto.randomUUID(),
      file,
      fansly: false,
      status: file.size > MAX_BYTES ? "error" : "waiting",
      pct: 0,
      path: null,
      thumbPath: null,
      thumbUrl: null,
    }));
    setTakes((l) => [...l, ...fresh]);
    const go = fresh.filter((t) => t.status === "waiting");
    if (go.length) void upload(go);
  }

  async function send() {
    setSending(true);
    try {
      // The frame each card shows becomes the take's picture, as on the upload page.
      const ready = await Promise.all(
        done.map(async (t) => {
          const frame = takeFrames.get(t.file);
          let thumbPath: string | null = null;
          if (frame && t.thumbUrl) {
            const ok = await fetch(t.thumbUrl, {
              method: "PUT",
              headers: { "content-type": "image/jpeg", "x-upsert": "true" },
              body: frame,
            })
              .then((r) => r.ok)
              .catch(() => false);
            if (ok) thumbPath = t.thumbPath;
          }
          return { path: t.path!, name: t.file.name, mime: resolveMime(t.file), size: t.file.size, thumbPath, fansly: t.fansly };
        })
      );
      const res = await shootSend(token, ready, { nsfw: isNsfw });
      if (res.error) return void toast.error(res.error);
      if (ready.length < takes.length) toast.warning(`${takes.length - ready.length} take(s) failed and were left out`);
      setSent({ title: res.title, count: ready.length });
      setTakes([]);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <div>
          <p className="text-lg font-semibold">{sent.title ?? "Sent"} is with the editor</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {sent.count} take{sent.count === 1 ? "" : "s"} sent · it is ticked off in SHOOTING. You can go back to Telegram.
          </p>
        </div>
        <Button variant="outline" className="h-11 w-full" onClick={() => setSent(null)}>
          Add more takes
        </Button>
      </div>
    );
  }

  const total = takes.reduce((a, t) => a + t.file.size, 0) || 1;
  const pct = Math.round((takes.reduce((a, t) => a + (t.file.size * t.pct) / 100, 0) / total) * 100);

  return (
    <div className="space-y-4">
      {askNsfw && !existingTitle && (
        <button
          type="button"
          onClick={() => setIsNsfw((v) => !v)}
          disabled={sending}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
            isNsfw ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-green-500/40 bg-green-500/10 text-green-400"
          }`}
        >
          <span>{isNsfw ? "NSFW" : "SFW"}</span>
          <span className="text-[11px] uppercase tracking-wider opacity-70">tap to switch</span>
        </button>
      )}

      <div
        className="space-y-2"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <Label>Takes</Label>
        <input
          ref={input}
          type="file"
          accept="video/*,image/*,.mov,.MOV"
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <TakeGrid
          takes={takes}
          maxMb={MAX_UPLOAD_MB}
          disabled={sending}
          dragOver={dragOver}
          onAdd={() => input.current?.click()}
          onRemove={(t) => setTakes((l) => l.filter((x) => x.id !== t.id))}
          onRetry={(t) => {
            if (t.file.size > MAX_BYTES) return;
            patch(t.id, { status: "waiting", pct: 0 });
            void upload([t]);
          }}
          onFansly={(t) => patch(t.id, { fansly: !t.fansly })}
        />
      </div>

      {busy && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {pct}% · {done.length}/{takes.length} takes uploaded — keep this page open
          </p>
        </div>
      )}
      <Button className="h-12 w-full text-base" disabled={busy || sending || done.length === 0} onClick={send}>
        {sending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Sending…
          </>
        ) : existingTitle ? (
          `Add ${done.length || ""} take${done.length === 1 ? "" : "s"} to ${existingTitle}`
        ) : (
          `Send ${done.length || ""} take${done.length === 1 ? "" : "s"} to editing`
        )}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">The inspo link and the notes go with the job on their own.</p>
    </div>
  );
}
