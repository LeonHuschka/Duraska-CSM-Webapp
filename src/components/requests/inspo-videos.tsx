"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { quickVideoFrame } from "@/lib/thumbnails";
import { createClient } from "@/lib/supabase/client";
import { setInspoVideo } from "@/app/(app)/requests/[id]/actions";

const VIDEO = "aspect-[9/16] w-36 rounded-xl border border-border/50 bg-black object-cover sm:w-44";

/** A stored reel with its first frame as poster — a paused video shows black. */
export function PosterVideo({ url, label }: { url: string; label: string }) {
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let gone = false;
    quickVideoFrame(url, 25_000).then((blob) => {
      if (!blob || gone) return;
      made = URL.createObjectURL(blob);
      setPoster(made);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return (
    <div className="shrink-0">
      <video src={url} poster={poster ?? undefined} controls playsInline preload="metadata" className={VIDEO} />
      <p className="mt-1 text-center text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * An inspo reel nobody has a video of yet: drop the file in, or paste a
 * link to fetch it. On a Trial-Maxxing job it is the original the viral
 * reel was shot from, given once for every job of the trial.
 */
export function InspoSlot({
  personaId,
  requestId,
  trialId = null,
  link,
  label,
}: {
  personaId: string;
  requestId: string;
  trialId?: string | null;
  link: string | null;
  label: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(link ?? "");
  const [busy, setBusy] = useState<"link" | "file" | null>(null);
  const [over, setOver] = useState(false);

  const send = async () => {
    if (!value.trim() || busy) return;
    setBusy("link");
    try {
      const res = await fetch(
        trialId ? `/api/trials/inspo?id=${trialId}` : `/api/links/request-video?id=${requestId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link: value.trim() }),
        }
      );
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; note?: string };
      if (!out.ok) toast.error(`Could not fetch it: ${out.note ?? res.status}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.type.startsWith("video/")) {
      toast.error("That is not a video");
      return;
    }
    setBusy("file");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `personas/${personaId}/inspo/${trialId ? `trial-${trialId}` : `request-${requestId}`}-${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient()
        .storage.from("content-assets")
        .upload(path, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      const res = await setInspoVideo({ requestId, trialId, path });
      if (res.error) throw new Error(res.error);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shrink-0">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={`${VIDEO} flex cursor-pointer flex-col justify-center gap-2 p-3 transition-colors ${
          over ? "border-primary bg-primary/10" : "bg-muted/20"
        }`}
      >
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy === "file" ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="mx-auto h-5 w-5 text-muted-foreground" />
        )}
        <p className="text-center text-[11px] text-muted-foreground">
          {busy === "file" ? "Uploading…" : "Drop the video here"}
        </p>
        <p className="text-center text-[10px] text-muted-foreground/70">or paste a link</p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder="instagram.com/reel/…"
          className="h-8 w-full rounded-md border border-border/50 bg-background px-2 text-xs outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            void send();
          }}
          disabled={!!busy || !value.trim()}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          {busy === "link" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy === "link" ? "Fetching…" : "Add"}
        </button>
      </label>
      <p className="mt-1 text-center text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
