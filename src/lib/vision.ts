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
            caption: { type: ["string", "null"], description: "Caption text on the tile, if any" },
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
 * Which of our reels is on each tile of the grid?
 *
 * Position is not identity. The same reel appears in every screenshot for
 * weeks, drifting one place further back as newer ones are posted, and a
 * reel posted outside the app occupies a tile we know nothing about — so
 * "tile 2 is the second-most-recently posted reel" is a guess that breaks
 * the moment anything is out of order.
 *
 * The tile is a still from our own video, so the picture answers it. The
 * grid goes in alongside the candidates' thumbnails and the model says
 * which is which, or says it can't tell.
 */
export interface GridMatch {
  position: number;
  /** index into the candidates array, or null when nothing matches */
  candidate: number | null;
  confidence: number;
}

const MATCH_TOOL = {
  name: "match_tiles",
  description:
    "For each tile of the grid, name the candidate thumbnail showing the same video.",
  input_schema: {
    type: "object" as const,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            position: {
              type: "integer",
              description: "Tile number, counting reels only, 1 = first",
            },
            candidate: {
              type: ["integer", "null"],
              description:
                "1-based index of the matching candidate image, or null if none of them is this video",
            },
            confidence: {
              type: "number",
              description: "0..1 for this single tile",
            },
          },
          required: ["position", "candidate", "confidence"],
        },
      },
    },
    required: ["matches"],
  },
};

export async function matchGridToReels(
  gridImage: { base64: string; mime: string },
  candidates: { base64: string; mime: string }[]
): Promise<{ data: GridMatch[] | null; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { data: null, error: "ANTHROPIC_API_KEY not set" };
  if (candidates.length === 0) return { data: [], error: undefined };

  const content: unknown[] = [
    {
      type: "text",
      text: "This is the grid of reels on the account. Tiles are numbered by reels only, left to right, top to bottom — ignore photo posts.",
    },
    {
      type: "image",
      source: { type: "base64", media_type: gridImage.mime, data: gridImage.base64 },
    },
    {
      type: "text",
      text: `Now ${candidates.length} candidate videos, numbered 1 to ${candidates.length}:`,
    },
  ];
  candidates.forEach((c, i) => {
    content.push({ type: "text", text: `Candidate ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: c.mime, data: c.base64 },
    });
  });

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
        system: `You match thumbnails of the same video.

The grid tiles are small, cropped and compressed; a candidate is a frame
from the same video but not necessarily the same frame. Judge by person,
outfit, background, framing and any on-screen text.

Rules:
- A tile may show a video that is not among the candidates. Answer null for
  it. A wrong match is far worse than an honest null, because the numbers
  would then be filed under someone else's video.
- Never use the same candidate twice. Each video appears once in a grid.
- Give a per-tile confidence and be strict: below 0.7 means unsure.`,
        tools: [MATCH_TOOL],
        tool_choice: { type: "tool", name: "match_tiles" },
        messages: [{ role: "user", content }],
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
      (c) => c.type === "tool_use" && c.name === "match_tiles"
    );
    if (!toolUse?.input) return { data: null, error: "no structured output" };

    const raw = (toolUse.input as { matches?: GridMatch[] }).matches ?? [];
    const used = new Set<number>();
    const out: GridMatch[] = [];
    for (const m of raw) {
      if (typeof m?.position !== "number") continue;
      let candidate =
        typeof m.candidate === "number" && m.candidate >= 1 ? m.candidate : null;
      const confidence = typeof m.confidence === "number" ? m.confidence : 0;
      // Belt and braces: the instruction not to reuse a candidate is a
      // request, this is the guarantee. Also drop anything the model itself
      // called unsure rather than filing views under the wrong reel.
      if (candidate !== null && (used.has(candidate) || confidence < 0.7)) {
        candidate = null;
      }
      if (candidate !== null) used.add(candidate);
      out.push({ position: m.position, candidate, confidence });
    }
    return { data: out };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "match call failed",
    };
  }
}
