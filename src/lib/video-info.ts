/**
 * The shape and length of an MP4 or MOV, read from its header boxes — what
 * Telegram needs to draw a video at the right shape instead of guessing.
 * Width and height are as shown: a phone video stored sideways with a
 * 90° turn in its matrix comes back upright. Null when the file says
 * nothing readable.
 */
export function videoInfo(buf: Uint8Array): { width: number; height: number; duration: number | null } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size: { width: number; height: number } | null = null;
  let duration: number | null = null;

  const type = (at: number) => String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);

  const walk = (start: number, end: number) => {
    let at = start;
    while (at + 8 <= end) {
      let len = view.getUint32(at);
      const kind = type(at + 4);
      let head = 8;
      if (len === 1) {
        if (at + 16 > end) return;
        len = Number(view.getBigUint64(at + 8));
        head = 16;
      } else if (len === 0) len = end - at;
      if (len < head || at + len > end) return;
      const body = at + head;
      if (kind === "moov" || kind === "trak") walk(body, at + len);
      else if (kind === "mvhd" && duration === null) {
        const v1 = buf[body] === 1;
        const scale = view.getUint32(body + (v1 ? 20 : 12));
        const dur = v1 ? Number(view.getBigUint64(body + 24)) : view.getUint32(body + 16);
        if (scale > 0) duration = dur / scale;
      } else if (kind === "tkhd" && !size) {
        const v1 = buf[body] === 1;
        const matrix = body + (v1 ? 52 : 40);
        if (matrix + 44 <= at + len) {
          const w = view.getUint32(matrix + 36) / 65536;
          const h = view.getUint32(matrix + 40) / 65536;
          if (w > 0 && h > 0) {
            // A quarter turn either way swaps what is wide and what is tall.
            const a = view.getInt32(matrix);
            const b = view.getInt32(matrix + 4);
            const turned = a === 0 && Math.abs(b) === 65536;
            size = turned ? { width: Math.round(h), height: Math.round(w) } : { width: Math.round(w), height: Math.round(h) };
          }
        }
      }
      at += len;
    }
  };

  try {
    walk(0, buf.byteLength);
  } catch {
    return null;
  }
  const s = size as { width: number; height: number } | null;
  return s ? { ...s, duration } : null;
}
