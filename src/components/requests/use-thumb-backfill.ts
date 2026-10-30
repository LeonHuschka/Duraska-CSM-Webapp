"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { quickVideoFrame, thumbnailPathFor } from "@/lib/thumbnails";
import { saveAssetThumbnail } from "@/app/(app)/vault/actions";
import type { AssetWithUrl } from "@/app/(app)/requests/[id]/page";

/**
 * Videos on a job that have no thumbnail — takes from trial boxes, the
 * drop zone, or uploads from before the upload tab stored one — get it
 * here, two at a time: the first frame of the video, read from storage,
 * stored next to it, so the next visit has it straight away. Returns the
 * fresh pictures by asset id to show in the meantime.
 */
export function useThumbBackfill(assets: AssetWithUrl[]): Record<string, string> {
  const [made, setMade] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());

  useEffect(() => {
    const todo = assets.filter(
      (a) => a.mime_type?.startsWith("video/") && !a.thumbnailUrl && !tried.current.has(a.id)
    );
    if (todo.length === 0) return;
    for (const a of todo) tried.current.add(a.id);
    // Runs to the end even if the page refreshes meanwhile: each one is
    // tried once per visit, and a picture half made would be thrown away.
    const work = async () => {
      for (let a = todo.shift(); a; a = todo.shift()) {
        try {
          // Played muted in the page for an instant, like the upload cards:
          // a detached video seeking to a frame stalls on phones and .mov.
          const thumb = await quickVideoFrame(a.signedUrl, 25_000);
          if (!thumb) continue;
          const tPath = thumbnailPathFor(a.file_path);
          const { error } = await createClient()
            .storage.from("content-assets")
            .upload(tPath, thumb, { contentType: "image/jpeg", upsert: true });
          if (error) continue;
          await saveAssetThumbnail({ asset_id: a.id, thumbnail_path: tPath });
          const url = URL.createObjectURL(thumb);
          setMade((m) => ({ ...m, [a!.id]: url }));
        } catch {
          // No picture for this one; the grey box stays.
        }
      }
    };
    void Promise.all([work(), work()]);
  }, [assets]);

  return made;
}
