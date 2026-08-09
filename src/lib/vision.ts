import "server-only";

/**
 * Read the numbers off an account screenshot with Claude's vision model.
 *
 * The model is forced through a tool schema so we get typed JSON back
 * rather than prose we'd have to parse. Every numeric field is optional —
 * a screenshot only shows some of them, and inventing the rest would be
 * worse than leaving them null.
 */

export interface ExtractedReel {
  position: number;
  views: number | null;
  likes: number | null;
  caption: string | null;
  /** Tile bounds as fractions of the image, for cutting it back out. */
  box: { x: number; y: number; w: number; h: number } | null;
}

export interface ExtractedMetrics {
  handle: string | null;
  platform: string | null;
  metric_kind: "profile" | "post" | "story" | "reel" | "reel_grid" | "unknown";
  period: string | null;
  followers: number | null;
  follows: number | null;
  posts_count: number | null;
  views: number | null;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  profile_visits: number | null;
  /** One entry per tile when the screenshot is a grid of reels. */
  reels: ExtractedReel[];
  confidence: number;
  notes: string | null;
}

const TOOL = {
  name: "record_metrics",
  description:
    "Record the account statistics visible in the screenshot. Only fill a field if the number is actually visible; leave it null otherwise.",
  input_schema: {
    type: "object" as const,
    properties: {
      handle: {
        type: ["string", "null"],
        description: "Account handle without the @, if visible",
      },
      platform: {
        type: ["string", "null"],
        description: "instagram, facebook, tiktok or x, if identifiable",
      },
      metric_kind: {
        type: "string",
        enum: ["profile", "post", "story", "reel", "reel_grid", "unknown"],
        description:
          "profile = account overview/insights, post/reel/story = stats of a single piece of content, reel_grid = a grid or row of several reel thumbnails each with its own view count",
      },
      period: {
        type: ["string", "null"],
        description: "Time range shown, e.g. 'last 7 days', 'last 30 days', 'lifetime'",
      },
      followers: { type: ["integer", "null"] },
      follows: { type: ["integer", "null"] },
      posts_count: { type: ["integer", "null"] },
      views: { type: ["integer", "null"] },
      reach: { type: ["integer", "null"] },
      impressions: { type: ["integer", "null"] },
      likes: { type: ["integer", "null"] },
      comments: { type: ["integer", "null"] },
      shares: { type: ["integer", "null"] },
      saves: { type: ["integer", "null"] },
      profile_visits: { type: ["integer", "null"] },
      reels: {
        type: "array",
        description:
          "For metric_kind=reel_grid only: one entry per REEL/VIDEO tile, in reading order (newest first, left to right, then next row). Photo and feed-post tiles are not reels — leave them out entirely and do not count them when numbering. Also skip the 'create reel' tile.",
        items: {
          type: "object",
          properties: {
            position: {
              type: "integer",
              description:
                "Counting REELS ONLY: 1 for the first reel in reading order, then 2, 3, … Photos in between must not consume a number.",
            },
            views: { type: ["integer", "null"], description: "The play/view count on the tile" },
            likes: { type: ["integer", "null"] },
            caption: {
              type: ["string", "null"],
              description:
                "Text visible ON the tile image itself — the hook rendered into the video (e.g. \"Me when I realize I'm losing the argument:\"). Copy it verbatim, including line breaks as spaces. Null if the tile carries no text.",
            },
            box: {
              type: ["object", "null"],
              description:
                "Where this tile sits in the image, as fractions of the full width and height (0..1). Give the picture area only — not the surrounding page, and not the phone's bezel if the screenshot is a photo of a screen.",
              properties: {
                x: { type: "number", description: "Left edge, 0..1" },
                y: { type: "number", description: "Top edge, 0..1" },
                w: { type: "number", description: "Width, 0..1" },
                h: { type: "number", description: "Height, 0..1" },
              },
              required: ["x", "y", "w", "h"],
            },
          },
          required: ["position"],
        },
      },
      confidence: {
        type: "number",
        description:
          "0..1 — how sure you are the numbers were read correctly. Use <0.6 if the image is blurry, cropped or ambiguous.",
      },
      notes: {
        type: ["string", "null"],
        description: "Anything odd worth a human glance",
      },
    },
    required: ["metric_kind", "confidence"],
  },
};

/**
 * A box is only useful if it could plausibly be a reel tile. Models
 * occasionally return the whole image or a sliver; cropping on that would
 * produce a fingerprint of nothing and a confident wrong answer downstream.
 */
function validBox(b: unknown): ExtractedReel["box"] {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const x = n(o.x), y = n(o.y), w = n(o.w), h = n(o.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.02 || y + h > 1.02) return null;
  // A reel tile is portrait and a fraction of the page. Anything near
  // full-height or wider than tall is not one.
  if (w > 0.6 || h > 0.7) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

const SYSTEM = `You read social-media analytics screenshots and extract the numbers.

Rules:
- Only report numbers that are actually visible. Never estimate or infer.
- Expand abbreviated counts: "12.4K" -> 12400, "1.2M" -> 1200000, "1,234" -> 1234.
- German UI is common: Follower=followers, Gefolgt=follows, Beiträge=posts_count,
  Aufrufe/Wiedergaben=views, Reichweite=reach, Impressionen=impressions,
  "Gefällt mir"=likes, Kommentare=comments, Geteilt=shares, Gespeichert=saves,
  Profilaufrufe=profile_visits.
- A grid or horizontal row of reel thumbnails, each with a small play/eye
  count on it, is metric_kind="reel_grid". Fill the "reels" array with one
  entry per REEL and leave the single-value fields null. The order is what
  the app relies on, so do not reorder or sort them.
- Such a grid often mixes reels with ordinary photo posts. Only reels count:
  they carry a video/reel glyph and a play or view count. A tile that is
  just a photo — no video marker, no view count — must be left out
  completely and must NOT consume a position number, because the numbering
  is how each reel is matched to its record. One photo counted by mistake
  shifts every reel after it onto the wrong record.
- Give a "box" for every reel tile: where its picture sits in the image, as
  fractions of the full width and height. This is used to cut the tile back
  out and compare it against our own videos, so it must frame the picture
  itself — tight, and without the page around it. If the screenshot is a
  photo of a phone screen, exclude the bezel and the room behind it.
- "caption" is the text rendered INTO the video and visible on the tile, not
  the post's written caption. Copy it exactly as it reads.
- If a reel's number is unreadable, still emit that reel with views=null.
  Dropping it would shift the ones after it, which is the same damage.
- If the image is not an analytics screenshot at all, set metric_kind="unknown"
  and confidence=0.
- A photograph of a screen (visible glare, tilt, moiré) is not a screenshot:
  read what is legible, and lower confidence below 0.6.`;

export async function extractMetricsFromImage(
  imageBase64: string,
  mediaType: string
): Promise<{ data: ExtractedMetrics | null; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { data: null, error: "ANTHROPIC_API_KEY not set" };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5",
        max_tokens: 1024,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "record_metrics" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: "Extract the account statistics from this screenshot.",
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { data: null, error: `anthropic ${res.status}: ${body.slice(0, 200)}` };
    }

    const json = (await res.json()) as {
      content: { type: string; name?: string; input?: unknown }[];
    };
    const toolUse = json.content?.find(
      (c) => c.type === "tool_use" && c.name === "record_metrics"
    );
    if (!toolUse?.input) return { data: null, error: "no structured output" };

    const raw = toolUse.input as Partial<ExtractedMetrics>;
    return {
      data: {
        handle: raw.handle ?? null,
        platform: raw.platform ?? null,
        metric_kind: raw.metric_kind ?? "unknown",
        period: raw.period ?? null,
        followers: raw.followers ?? null,
        follows: raw.follows ?? null,
        posts_count: raw.posts_count ?? null,
        views: raw.views ?? null,
        reach: raw.reach ?? null,
        impressions: raw.impressions ?? null,
        likes: raw.likes ?? null,
        comments: raw.comments ?? null,
        shares: raw.shares ?? null,
        saves: raw.saves ?? null,
        profile_visits: raw.profile_visits ?? null,
        reels: Array.isArray(raw.reels)
          ? raw.reels
              .filter((r) => r && typeof r.position === "number")
              .map((r) => ({
                position: r.position,
                views: r.views ?? null,
                likes: r.likes ?? null,
                caption: r.caption ?? null,
                box: validBox(r.box),
              }))
          : [],
        confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
        notes: raw.notes ?? null,
      },
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "vision call failed",
    };
  }
}


/**
 * Read the hook text off a batch of our own thumbnails.
 *
 * Runs once per cut, not once per screenshot: the text a clip carries never
 * changes, so this is a property of the video, stored alongside its hash.
 * Batched because the cost is per call far more than per image.
 */
export async function readOverlayTexts(
  images: { base64: string; mime: string }[]
): Promise<{ data: (string | null)[] | null; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { data: null, error: "ANTHROPIC_API_KEY is not set" };
  if (images.length === 0) return { data: [] };

  const tool = {
    name: "record_texts",
    description: "Report the on-image text of each numbered picture.",
    input_schema: {
      type: "object" as const,
      properties: {
        texts: {
          type: "array",
          description: "One entry per picture, in the order given.",
          items: {
            type: "object",
            properties: {
              index: { type: "integer", description: "1-based picture number" },
              text: {
                type: ["string", "null"],
                description:
                  "The text rendered into the picture, verbatim. Null if it carries none.",
              },
            },
            required: ["index"],
          },
        },
      },
      required: ["texts"],
    },
  };

  const content: unknown[] = [
    {
      type: "text",
      text:
        `Here are ${images.length} video thumbnails, numbered 1 to ${images.length}.\n\n` +
        `For each, copy the text that is rendered INTO the picture — the hook or caption ` +
        `burnt into the video frame. Copy it exactly as written, including spelling. ` +
        `Do not describe the picture, do not invent text, and do not read any interface ` +
        `elements such as timestamps or buttons. If a picture carries no text, return null.`,
    },
  ];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mime, data: img.base64 },
    });
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5",
        max_tokens: 2048,
        tools: [tool],
        tool_choice: { type: "tool", name: "record_texts" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      return { data: null, error: `Anthropic answered ${res.status}` };
    }
    const body = (await res.json()) as {
      content?: { type: string; input?: { texts?: { index?: number; text?: string | null }[] } }[];
    };
    const use = body.content?.find((c) => c.type === "tool_use");
    const rows = use?.input?.texts ?? [];
    const out: (string | null)[] = new Array(images.length).fill(null);
    for (const r of rows) {
      const i = typeof r.index === "number" ? r.index - 1 : -1;
      if (i >= 0 && i < out.length) {
        out[i] = typeof r.text === "string" && r.text.trim() !== "" ? r.text.trim() : null;
      }
    }
    return { data: out };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "text call failed",
    };
  }
}
