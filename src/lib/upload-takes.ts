"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Putting a take into storage from a phone, with real byte progress.
 * The same rules the upload page follows: iOS hands camera-roll videos over
 * with an empty type, so the extension decides; a signed URL and XHR give a
 * progress number the SDK upload cannot.
 */
const MEDIA_EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
};

export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 2048);

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

export function isMediaFile(f: File): boolean {
  if (f.type.startsWith("video/") || f.type.startsWith("image/")) return true;
  if (!f.type) return true;
  return !!MEDIA_EXT_MIME[extOf(f.name)];
}

export function resolveMime(f: File): string {
  if (f.type) return f.type;
  return MEDIA_EXT_MIME[extOf(f.name)] ?? "application/octet-stream";
}

function putWithProgress(url: string, file: File, mime: string, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", mime);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? (onProgress(file.size), resolve()) : reject(new Error(`upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.ontimeout = () => reject(new Error("upload timed out"));
    xhr.send(file);
  });
}

/** Upload one file to `path`; resolves when the bytes are in storage. */
export async function uploadToStorage(
  supabase: SupabaseClient,
  path: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  const mime = resolveMime(file);
  const { data: signed } = await supabase.storage.from("content-assets").createSignedUploadUrl(path);
  if (signed?.signedUrl) {
    await putWithProgress(signed.signedUrl, file, mime, (loaded) => onProgress(Math.round((loaded / (file.size || 1)) * 100)));
    return;
  }
  const { error } = await supabase.storage.from("content-assets").upload(path, file, { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);
  onProgress(100);
}
