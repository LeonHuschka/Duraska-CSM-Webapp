"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImagePlus, Images, Loader2, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { postNow, schedulePost } from "@/app/(app)/planner/[accountId]/actions";
import { atTime, dayKey, hhmm, tzLabel, whenLabel } from "@/components/planner/planner-utils";

const MAX_PICTURES = 10;
const MAX_CAPTION = 2200;
/** Instagram's feed takes 4:5 (tall) to 1.91:1 (wide); the rest is cropped to fit. */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;
const MAX_WIDTH = 1440;

type Picture = { id: string; file: File; url: string; ratio: number };

/**
 * A feed post: drop one picture or up to ten for a carousel, put them in
 * order, write the caption and pick the time. The pictures become JPEGs
 * cut to the first one's shape (Instagram crops a carousel to it anyway)
 * when it is scheduled.
 */
export function FeedComposer({
  accountId,
  personaId,
  at,
  tz,
  lastCaption,
  canPublish,
  onClose,
  onChanged,
}: {
  accountId: string;
  personaId: string;
  at: Date | null;
  tz: string;
  lastCaption: string | null;
  canPublish: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pics, setPics] = useState<Picture[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<null | "save" | "post">(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!at) return;
    setPics((old) => {
      old.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setDate(dayKey(at, tz));
    setTime(hhmm(at, tz));
    setCaption("");
  }, [at, tz]);

  if (!at) return null;
  const ratio = pics[0] ? clamp(pics[0].ratio) : 1;
  const when = date && time ? atTime(date, time, tz) : new Date(NaN);
  const tags = caption.match(/#[^\s#]+/g)?.length ?? 0;
  const tooLong = caption.length > MAX_CAPTION || tags > 30;

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return void toast.error("Pictures only — JPG, PNG or WebP");
    const room = MAX_PICTURES - pics.length;
    if (list.length > room) toast.error(`A carousel takes ${MAX_PICTURES} pictures — the rest were left out`);
    const added: Picture[] = [];
    for (const file of list.slice(0, room)) {
      try {
        const bmp = await createImageBitmap(file);
        added.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), ratio: bmp.width / bmp.height });
        bmp.close();
      } catch {
        toast.error(`${file.name}: this picture cannot be read here — save it as JPG or PNG first`);
      }
    }
    setPics((p) => [...p, ...added]);
  };
  const move = (i: number, dir: number) =>
    setPics((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async (now: boolean) => {
    if (!pics.length) return void toast.error("Add a picture first");
    if (!now && (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000)) {
      return void toast.error("That time has passed — pick a later one or post now");
    }
    setBusy(now ? "post" : "save");
    try {
      const supabase = createClient();
      const paths: string[] = [];
      for (const p of pics) {
        const jpeg = await toJpeg(p.file, ratio);
        const path = `personas/${personaId}/feed/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("content-assets").upload(path, jpeg, { contentType: "image/jpeg" });
        if (error) throw new Error(error.message);
        paths.push(path);
      }
      const res = await schedulePost({
        accountId,
        feedPaths: paths,
        scheduledFor: (now ? new Date() : when).toISOString(),
        caption,
        trialReel: false,
        shareToFeed: true,
      });
      if (res.error || !res.id) throw new Error(res.error ?? "Not saved");
      if (now) {
        const out = await postNow(res.id);
        if (out.error) toast.error(`Not posted: ${out.error}`);
        else toast.success("Posted 🎉");
      } else {
        toast.success(`${pics.length > 1 ? "Carousel" : "Feed post"} scheduled for ${whenLabel(when, tz)}`);
      }
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Not saved");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-border/50 px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Images className="h-4 w-4" />
            {pics.length > 1 ? `Carousel · ${pics.length} pictures` : "Feed post"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 p-5 sm:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void add(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-5 text-center text-xs transition-colors ${
                dragOver ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60"
              } ${pics.length >= MAX_PICTURES ? "pointer-events-none opacity-40" : ""}`}
            >
              <ImagePlus className="h-5 w-5" />
              Drop pictures or click
              <span className="text-[10px]">1 = single post · 2–10 = carousel</span>
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void add(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {pics.map((p, i) => (
                <div key={p.id} className="group relative overflow-hidden rounded-md bg-black" style={{ aspectRatio: String(ratio) }}>
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPics((l) => l.filter((x) => x.id !== p.id));
                    }}
                    className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  {pics.length > 1 && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-between p-0.5 opacity-0 group-hover:opacity-100">
                      <button type="button" onClick={() => move(i, -1)} className="rounded bg-black/70 p-0.5 text-white" title="Earlier">
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} className="rounded bg-black/70 p-0.5 text-white" title="Later">
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {pics.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Shape {ratio >= 0.99 && ratio <= 1.01 ? "1:1" : ratio < 1 ? "4:5 tall" : "wide"} from picture 1 — the others are
                cropped to it.
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Day · {tzLabel(tz)}</span>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Time</span>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" />
              </label>
            </div>
            <label className="space-y-1">
              <span className="flex items-baseline justify-between text-[11px] font-medium text-muted-foreground">
                Caption
                <span className={tooLong ? "text-rose-400" : ""}>
                  {caption.length}/{MAX_CAPTION} · {tags}/30 #
                </span>
              </span>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={8}
                placeholder="Write the caption — hashtags at the end"
                className="resize-none text-sm"
              />
              {lastCaption && !caption && (
                <button type="button" onClick={() => setCaption(lastCaption)} className="text-[11px] text-primary hover:underline">
                  Use the last caption
                </button>
              )}
            </label>
            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => save(true)}
                disabled={!!busy || tooLong || !canPublish || !pics.length}
                title={canPublish ? "Publish right away" : "Connect Instagram first"}
              >
                {busy === "post" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                Post now
              </Button>
              <Button size="sm" onClick={() => save(false)} disabled={!!busy || tooLong || !pics.length || !date || !time}>
                {busy === "save" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Schedule
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function clamp(r: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

/** The picture as a JPEG of that shape, cut from its middle, at most 1440 wide. */
async function toJpeg(file: File, ratio: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  let sw = bmp.width;
  let sh = bmp.height;
  if (sw / sh > ratio) sw = Math.round(sh * ratio);
  else sh = Math.round(sw / ratio);
  const sx = Math.round((bmp.width - sw) / 2);
  const sy = Math.round((bmp.height - sh) / 2);
  const w = Math.min(MAX_WIDTH, sw);
  const h = Math.round(w / ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot convert pictures");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not convert the picture"))), "image/jpeg", 0.9)
  );
}
