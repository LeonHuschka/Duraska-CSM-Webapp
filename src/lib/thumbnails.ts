/**
 * Client-side thumbnail generation.
 *
 * For images: resize to a max width and re-encode as JPEG.
 * For videos: load via blob URL, seek to 0.5 s (or 10 % of duration),
 * draw the frame to a canvas, encode as JPEG.
 *
 * The generated thumbnails are tiny (~10–40 KB at quality 0.72, max
 * 480 px wide). We use them in vault / schedule / gallery grids
 * instead of fetching the full media for preview, slashing egress.
 */

const THUMB_MAX_WIDTH = 480;
const THUMB_QUALITY = 0.72;

export async function generateThumbnail(file: File | Blob, mimeType?: string): Promise<Blob | null> {
  const type = mimeType || (file as File).type || "";
  try {
    if (type.startsWith("image/")) {
      return await thumbnailFromImage(file);
    }
    if (type.startsWith("video/")) {
      return await thumbnailFromVideo(file);
    }
  } catch (err) {
    console.warn("[thumbnails] generation failed", err);
  }
  return null;
}

async function thumbnailFromImage(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return drawToBlob(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function thumbnailFromVideo(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      video.onloadedmetadata = () => {
        cleanup();
        resolve();
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("video metadata load failed"));
      };
    });

    const seekTime = Math.min(0.5, (video.duration || 1) * 0.1);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.onseeked = null;
        video.onerror = null;
      };
      video.onseeked = () => {
        cleanup();
        resolve();
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("video seek failed"));
      };
      video.currentTime = seekTime;
    });

    return drawToBlob(video, video.videoWidth, video.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function drawToBlob(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number
): Promise<Blob | null> {
  if (!srcWidth || !srcHeight) return Promise.resolve(null);
  const ratio = Math.min(1, THUMB_MAX_WIDTH / srcWidth);
  const w = Math.round(srcWidth * ratio);
  const h = Math.round(srcHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", THUMB_QUALITY);
  });
}

/**
 * Derive the thumbnail storage path from the original file path.
 * Same folder, same basename, `.thumb.jpg` suffix.
 */
export function thumbnailPathFor(filePath: string): string {
  // Strip extension, append .thumb.jpg
  const dot = filePath.lastIndexOf(".");
  const slash = filePath.lastIndexOf("/");
  const base = dot > slash ? filePath.slice(0, dot) : filePath;
  return `${base}.thumb.jpg`;
}
