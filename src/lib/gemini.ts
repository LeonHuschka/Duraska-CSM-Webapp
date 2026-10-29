import "server-only";

/**
 * Gemini watches a video — picture and sound in one call — and answers in
 * JSON against a schema. Claude cannot take video, so this is the one place
 * a reel is actually seen rather than guessed from its cover.
 *
 * Small files (every reel we post) go inline; anything over INLINE_MAX goes
 * through the File API first. Key: GEMINI_API_KEY. Model: GEMINI_MODEL, by
 * default the Pro tier, used for every cohort alike so winners and losers
 * are judged by the same eyes.
 */
const BASE = "https://generativelanguage.googleapis.com";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-4-argon";
/** Request bodies stop at 20 MB; base64 adds a third. */
const INLINE_MAX = 14 * 1024 * 1024;
/** Dollars per million tokens, input and output (thinking counts as output). */
const PRICE: Record<string, [number, number]> = {
  "gemini-4-argon": [2, 10],
  "gemini-3.8-flash": [0.75, 3.75],
};

export type GeminiUsage = { input: number; output: number; usd: number };
export type GeminiResult<T> = { ok: true; value: T; usage: GeminiUsage } | { ok: false; note: string; usage?: GeminiUsage };

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

async function uploadFile(bytes: Uint8Array, mime: string, key: string): Promise<string> {
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "reel" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`file upload refused (${start.status})`);
  const done = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes as unknown as BodyInit,
  });
  const info = (await done.json().catch(() => null)) as { file?: { name?: string; uri?: string; state?: string } } | null;
  const name = info?.file?.name;
  if (!done.ok || !name || !info?.file?.uri) throw new Error(`file upload failed (${done.status})`);
  // A video is processed before it can be used.
  let state = info.file.state;
  for (let i = 0; state !== "ACTIVE" && i < 30; i++) {
    if (state === "FAILED") throw new Error("Gemini could not process the video");
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${BASE}/v1beta/${name}`, { headers: { "x-goog-api-key": key } });
    state = ((await s.json().catch(() => null)) as { state?: string } | null)?.state;
  }
  if (state !== "ACTIVE") throw new Error("video still processing after 90s");
  return info.file.uri;
}

/** One video, one prompt, one JSON answer shaped by `schema`. */
export async function watchVideo<T>(opts: {
  video: Uint8Array;
  mime?: string;
  system: string;
  prompt: string;
  schema: unknown;
}): Promise<GeminiResult<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, note: "GEMINI_API_KEY not set" };
  const mime = opts.mime ?? "video/mp4";

  let media: Record<string, unknown>;
  try {
    media =
      opts.video.byteLength <= INLINE_MAX
        ? { inlineData: { mimeType: mime, data: Buffer.from(opts.video).toString("base64") } }
        : { fileData: { mimeType: mime, fileUri: await uploadFile(opts.video, mime, key) } };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : "upload failed" };
  }

  const res = await fetch(`${BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [media, { text: opts.prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: opts.schema, temperature: 0 },
      // Creator reels are suggestive but not explicit; the default filters
      // refuse too many of them for a classification that only describes.
      safetySettings: [
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
      ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
    }),
    signal: AbortSignal.timeout(180_000),
  }).catch((err: unknown) => err as Error);
  if (res instanceof Error) return { ok: false, note: `Gemini unreachable: ${res.message}` };

  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  } | null;
  const u = body?.usageMetadata;
  const input = u?.promptTokenCount ?? 0;
  const output = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  const [pin, pout] = PRICE[GEMINI_MODEL] ?? PRICE["gemini-4-argon"];
  const usage = { input, output, usd: (input * pin + output * pout) / 1_000_000 };

  if (!res.ok) return { ok: false, note: `Gemini ${res.status}: ${body?.error?.message?.slice(0, 160) ?? "error"}`, usage };
  if (body?.promptFeedback?.blockReason) return { ok: false, note: `blocked: ${body.promptFeedback.blockReason}`, usage };
  const cand = body?.candidates?.[0];
  const textOut = (cand?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  if (!textOut) return { ok: false, note: `no answer (${cand?.finishReason ?? "unknown"})`, usage };
  try {
    return { ok: true, value: JSON.parse(textOut) as T, usage };
  } catch {
    return { ok: false, note: "answer was not JSON", usage };
  }
}
