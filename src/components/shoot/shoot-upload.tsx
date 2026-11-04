"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, Loader2, Plus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shootSend, shootUploadUrls } from "@/app/shoot/[token]/actions";
import { MAX_UPLOAD_MB, isMediaFile, putWithProgress, resolveMime } from "@/lib/upload-takes";
import { generateThumbnail } from "@/lib/thumbnails";

type Take = {
  id: string;
  file: File;
  status: "waiting" | "uploading" | "done" | "error";
  pct: number;
  path: string | null;
  thumbPath: string | null;
  fansly: boolean;
};

const CONCURRENCY = 2;

/**
 * The takes of one reel, from the phone straight into storage, then one
 * tap to make the job. Big buttons, nothing to type — she came here from
 * Telegram with a camera roll, not a keyboard.
 */
export function ShootUpload({ token, existingTitle }: { token: string; existingTitle: string | null }) {
  const [takes, setTakes] = useState<Take[]>([]);
  const [sending, setSending] = useState(false);
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
        patch(t.id, { status: "uploading", pct: 0, path: slot.path });
        try {
          const mime = resolveMime(t.file);
          await putWithProgress(slot.url, t.file, mime, (loaded) =>
            patch(t.id, { pct: Math.round((loaded / (t.file.size || 1)) * 100) })
          );
          let thumbPath: string | null = null;
          if (slot.thumbUrl) {
            const blob = await generateThumbnail(t.file, mime).catch(() => null);
            if (blob) {
              const ok = await fetch(slot.thumbUrl, {
                method: "PUT",
                headers: { "content-type": "image/jpeg", "x-upsert": "true" },
                body: blob,
              })
                .then((r) => r.ok)
                .catch(() => false);
              if (ok) thumbPath = slot.thumbPath;
            }
          }
          patch(t.id, { status: "done", pct: 100, thumbPath });
        } catch (err) {
          patch(t.id, { status: "error" });
          toast.error(`${t.file.name}: ${err instanceof Error ? err.message : "upload failed"} — tap ↻ to try again`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  }

  function add(files: FileList | null) {
    const picked = Array.from(files ?? []).filter(isMediaFile);
    if (!picked.length) return;
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`${tooBig.length} take(s) are over ${MAX_UPLOAD_MB} MB and were left out`);
    const fresh: Take[] = picked
      .filter((f) => f.size <= MAX_UPLOAD_MB * 1024 * 1024)
      .map((file) => ({ id: crypto.randomUUID(), file, status: "waiting", pct: 0, path: null, thumbPath: null, fansly: false }));
    setTakes((l) => [...l, ...fresh]);
    if (fresh.length) void upload(fresh);
  }

  async function send() {
    setSending(true);
    try {
      const res = await shootSend(
        token,
        done.map((t) => ({
          path: t.path!,
          name: t.file.name,
          mime: resolveMime(t.file),
          size: t.file.size,
          thumbPath: t.thumbPath,
          fansly: t.fansly,
        }))
      );
      if (res.error) return void toast.error(res.error);
      setSent({ title: res.title, count: done.length });
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
  const pct = Math.round(takes.reduce((a, t) => a + (t.file.size * t.pct) / 100, 0) / total * 100);

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant={takes.length ? "outline" : "default"}
        className="h-14 w-full text-base"
        onClick={() => input.current?.click()}
        disabled={sending}
      >
        <Plus className="mr-2 h-5 w-5" />
        {takes.length ? "Add more takes" : "Choose the takes"}
      </Button>

      {takes.length > 0 && (
        <ul className="space-y-1.5">
          {takes.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.file.name}</span>
              <button
                type="button"
                onClick={() => patch(t.id, { fansly: !t.fansly })}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  t.fansly ? "bg-pink-500/20 text-pink-300" : "bg-muted text-muted-foreground"
                }`}
                title="Shot in the Fansly outfit"
              >
                Fansly
              </button>
              {t.status === "uploading" && <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{t.pct}%</span>}
              {t.status === "waiting" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {t.status === "done" && <Check className="h-4 w-4 text-emerald-400" />}
              {t.status === "error" && (
                <button type="button" onClick={() => { patch(t.id, { status: "waiting", pct: 0 }); void upload([t]); }} title="Try again">
                  <RotateCw className="h-4 w-4 text-rose-400" />
                </button>
              )}
              {t.status !== "uploading" && (
                <button type="button" onClick={() => setTakes((l) => l.filter((x) => x.id !== t.id))} title="Remove">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {takes.length > 0 && (
        <Button className="h-14 w-full text-base" disabled={busy || sending || done.length === 0} onClick={send}>
          {sending || busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
          {busy
            ? `Uploading… ${pct}%`
            : existingTitle
              ? `Add ${done.length} take${done.length === 1 ? "" : "s"} to ${existingTitle}`
              : `Send ${done.length} take${done.length === 1 ? "" : "s"} to editing`}
        </Button>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        {busy ? "Keep this page open until the upload is done." : "The inspo link and the notes go with the job on their own."}
      </p>
    </div>
  );
}
