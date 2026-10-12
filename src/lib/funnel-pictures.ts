/**
 * A picture's address, with a tag taken from its stored path. Every upload
 * stores under a new path, so a new picture gets a new address and no
 * cache — the browser's or the CDN's — can keep showing the old one.
 */
export type PictureSlot = "cover" | "open-cover" | "button";

export function pictureUrl(base: string, slot: PictureSlot, path: string | null) {
  const tag = (path ?? "").split("/").pop()?.replace(/\.[a-z0-9]+$/i, "").split("-").pop() ?? "0";
  return `${base}/${slot}?v=${tag}`;
}
