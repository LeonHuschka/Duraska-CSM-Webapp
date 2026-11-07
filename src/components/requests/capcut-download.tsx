"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FolderDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { zipStore } from "@/lib/zip-store";

/**
 * Everything the editor needs for one reel in one go: the inspo and every
 * raw take, numbered in order, so the folder can be dragged into CapCut as
 * it is. In Chrome and Edge it writes a folder named after the reel into
 * a folder the editor picks (the picker remembers it); elsewhere one ZIP
 * of that folder, which Safari unpacks into Downloads by itself.
 */
type Item = { url: string; name: string };
type Take = { signedUrl: string; file_name: string; fansly?: boolean | null };

type DirHandle = {
  getDirectoryHandle(name: string, o: { create: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
};
type Picker = (o: { id?: string; mode?: "readwrite"; startIn?: string }) => Promise<DirHandle>;

const ext = (name: string, fallback: string) => name.match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase() ?? fallback;
const pad = (n: number) => String(n).padStart(2, "0");

export function CapCutDownload({
  title,
  inspoUrl,
  viralUrl,
  takes,
}: {
  title: string;
  inspoUrl: string | null;
  viralUrl?: string | null;
  takes: Take[];
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const folder = title.replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim() || "Reel";

  const items: Item[] = [];
  if (inspoUrl) items.push({ url: inspoUrl, name: `${folder} - 00 inspo${ext(new URL(inspoUrl).pathname, ".mp4")}` });
  if (viralUrl) items.push({ url: viralUrl, name: `${folder} - 00 went viral${ext(new URL(viralUrl).pathname, ".mp4")}` });
  takes
    .filter((t) => t.signedUrl)
    .forEach((t, i) =>
      items.push({ url: t.signedUrl, name: `${folder} - ${pad(i + 1)} take${t.fansly ? " fansly" : ""}${ext(t.file_name, ".mp4")}` })
    );

  async function toFolder(pick: Picker) {
    let root: DirHandle;
    try {
      root = await pick({ id: "capcut-takes", mode: "readwrite", startIn: "downloads" });
    } catch {
      return; // picker closed
    }
    const dir = await root.getDirectoryHandle(folder, { create: true });
    const total = items.length;
    for (let i = 0; i < total; i++) {
      const it = items[i];
      setProgress(`${i + 1}/${total}`);
      const res = await fetch(it.url);
      if (!res.ok || !res.body) throw new Error(`${it.name} could not be loaded`);
      const file = await dir.getFileHandle(it.name, { create: true });
      // Straight to disk — a phone's worth of 4K takes would not fit in memory.
      await res.body.pipeTo(await file.createWritable());
    }
    toast.success(`Folder "${folder}" is ready — drag it into CapCut`);
  }

  async function asZip() {
    // Safari opens a downloaded ZIP by itself: a folder named after the reel
    // lands in Downloads.
    const files: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setProgress(`${i + 1}/${items.length}`);
      const res = await fetch(it.url);
      if (!res.ok) throw new Error(`${it.name} could not be loaded`);
      files.push({ name: `${folder}/${it.name}`, data: new Uint8Array(await res.arrayBuffer()) });
    }
    const url = URL.createObjectURL(zipStore(files));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast.success(`"${folder}" is in Downloads — drag the folder into CapCut`);
  }

  async function run() {
    try {
      const pick = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
      await (pick ? toFolder(pick.bind(window)) : asZip());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The download failed");
    } finally {
      setProgress(null);
    }
  }

  if (items.length === 0) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={progress != null}
      onClick={run}
      title="The inspo and every raw take, numbered, in one folder — drag it into CapCut"
    >
      {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderDown className="h-4 w-4" />}
      {progress ? `Downloading ${progress}` : "Download for CapCut"}
    </Button>
  );
}
