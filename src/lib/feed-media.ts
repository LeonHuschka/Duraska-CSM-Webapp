/**
 * A feed post's files: pictures stored as JPEG, videos as they came, each
 * video with a still beside it (same name, ".cover.jpg") for the planner's
 * tiles — Instagram makes its own.
 */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|m4v)$/i.test(path);
}

/** The same for a signed link, whose path ends before the token. */
export function isVideoUrl(url: string): boolean {
  try {
    return isVideoPath(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function coverPath(videoPath: string): string {
  return videoPath.replace(/\.[a-z0-9]+$/i, ".cover.jpg");
}
