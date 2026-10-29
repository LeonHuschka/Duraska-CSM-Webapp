/**
 * The codebook: what Gemini is asked to see in a reel, as fixed values.
 *
 * Statistics can only count what is named the same way every time — "diving
 * dress", "neoprene dress" and "swim dress" are three things to a counter —
 * so every field that is compared is a closed list, and every list carries
 * "unclear" so nothing has to be made up. The few free-text fields (first
 * frame, overlay text, spoken words, items and accessories) are for reading,
 * and items and accessories are lower-cased short nouns so they still count.
 *
 * Bump CODEBOOK_VERSION whenever a list changes: reels classified on an older
 * version are classified again on the next run.
 */
export const CODEBOOK_VERSION = 1;

const U = "unclear";
const oneOf = (values: string[], description: string) => ({
  type: "string",
  enum: [...values, U],
  description,
});
const manyOf = (values: string[], description: string) => ({
  type: "array",
  items: { type: "string", enum: values },
  description,
});
const text = (description: string) => ({ type: ["string", "null"], description });
const num = (description: string) => ({ type: ["number", "null"], description });
const flag = (description: string) => ({ type: ["boolean", "null"], description });

export const LOCATIONS = [
  "bathroom", "bedroom", "living_room", "kitchen", "hallway", "mirror_room", "gym", "car",
  "street", "nature", "beach", "pool", "balcony", "office", "studio", "hotel", "shop", "other",
];
export const OUTFITS = [
  "swimwear", "one_piece_swim", "lingerie", "sleepwear", "dress", "skirt_top", "jeans_top",
  "gym_wear", "loungewear", "streetwear", "business", "towel_robe", "uniform_costume", "other",
];
export const COLORS = ["black", "white", "red", "pink", "blue", "green", "yellow", "orange", "purple", "brown", "beige", "grey", "multi"];
export const MOVES = [
  "turn_spin", "walk_to_camera", "walk_away", "hair_flip", "touch_hair", "dance", "lip_sync",
  "pose_switch", "adjust_clothing", "interact_object", "jump", "sit_down", "lie_down", "lean_in", "point_gesture", "none",
];

export const REEL_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One plain sentence: what happens in this reel." },
    visual: {
      type: "object",
      properties: {
        face_visible: oneOf(["yes", "partly", "no"], "Is the creator's face visible for most of the reel?"),
        shot_size: oneOf(["close_up", "medium", "full_body", "mixed"], "Dominant framing."),
        camera_angle: oneOf(["eye_level", "high", "low", "top_down", "mirror_selfie", "pov", "mixed"], "Dominant camera angle."),
        gaze: oneOf(["into_camera", "away", "mixed", "not_visible"], "Where the creator looks most of the time."),
        lighting: oneOf(["daylight", "warm_indoor", "cool_indoor", "ring_light", "flash", "low_light", "mixed"], "Dominant light."),
        palette: oneOf(["warm", "cool", "neutral", "pastel", "high_contrast", "dark"], "Overall colour feel."),
        aesthetic: oneOf(["casual_phone", "polished", "cinematic", "lofi_grainy"], "Look of the footage."),
        location: oneOf(LOCATIONS, "Where it is filmed."),
        location_detail: text("A few words on the setting, e.g. 'white tiled bathroom, shower behind'."),
        camera_motion: oneOf(["static", "handheld", "following", "selfie_handheld"], "How the camera moves."),
      },
      required: ["face_visible", "shot_size", "camera_angle", "gaze", "lighting", "palette", "aesthetic", "location", "location_detail", "camera_motion"],
    },
    hook: {
      type: "object",
      properties: {
        first_frame: { type: "string", description: "What the very first frame shows, in one line." },
        first_seconds: { type: "string", description: "What happens in seconds 0–3, in one or two lines." },
        hook_type: oneOf(["visual", "movement", "facial_expression", "reveal", "text", "spoken", "sound", "none"], "The main device that grabs attention at the start."),
        eye_contact_at_start: flag("Direct look into the camera in the first second."),
        motion_in_first_frame: flag("Is something already moving in the first frame?"),
        strongest_moment_s: num("Second at which the visually strongest moment happens."),
        seconds_to_grab: num("Seconds until the viewer is clearly addressed or something notable happens."),
      },
      required: ["first_frame", "first_seconds", "hook_type", "eye_contact_at_start", "motion_in_first_frame", "strongest_moment_s", "seconds_to_grab"],
    },
    outfit: {
      type: "object",
      properties: {
        category: oneOf(OUTFITS, "Main outfit category."),
        items: { type: "array", items: { type: "string" }, description: "Clothing pieces, lower-case short English nouns, e.g. 'diving dress', 'crop top'." },
        colors: manyOf(COLORS, "Main outfit colours."),
        fit: oneOf(["tight", "loose", "mixed"], "Cut and silhouette."),
        makeup: oneOf(["none_natural", "light", "glam"], "Make-up level."),
        hair: oneOf(["down", "ponytail", "bun", "braids", "wet", "half_up", "covered", "other"], "Hair style."),
        accessories: { type: "array", items: { type: "string" }, description: "Accessories, lower-case short English nouns, e.g. 'hairband', 'sunglasses'. Empty if none." },
        notable: text("Anything unusual about the styling, or null."),
      },
      required: ["category", "items", "colors", "fit", "makeup", "hair", "accessories", "notable"],
    },
    movement: {
      type: "object",
      properties: {
        pose: oneOf(["standing", "sitting", "lying", "walking", "dancing", "mixed"], "Main body position."),
        body_language: oneOf(["playful", "confident", "shy", "seductive", "neutral", "surprised", "funny"], "Dominant body language."),
        energy: oneOf(["static", "calm", "dynamic"], "How much movement overall."),
        moves: manyOf(MOVES, "Types of movement that happen."),
        direction: oneOf(["towards_camera", "away", "sideways", "in_place", "none"], "Main direction of movement."),
        interacts_with: manyOf(["hair", "clothing", "object", "environment", "other_person", "none"], "What she touches or plays with."),
        staging: oneOf(["natural", "posed"], "Natural behaviour or deliberately staged posing."),
      },
      required: ["pose", "body_language", "energy", "moves", "direction", "interacts_with", "staging"],
    },
    structure: {
      type: "object",
      properties: {
        duration_s: num("Length in seconds."),
        scenes: num("Number of distinct scenes or set-ups."),
        cuts: num("Number of cuts."),
        cut_pace: oneOf(["none", "slow", "medium", "fast"], "Editing pace."),
        sequence: { type: "string", description: "The order of what happens, in one line, e.g. 'mirror check → turn → close-up smile'." },
        loop_potential: oneOf(["low", "medium", "high"], "Does the end flow back into the start?"),
        ending: oneOf(["abrupt_cut", "loop_back", "reveal", "text_cta", "fade", "walk_out", "look_at_camera", "other"], "How it ends."),
        repeats: flag("Is a movement or scene repeated?"),
      },
      required: ["duration_s", "scenes", "cuts", "cut_pace", "sequence", "loop_potential", "ending", "repeats"],
    },
    audio_text: {
      type: "object",
      properties: {
        audio: oneOf(["music", "speech", "music_and_speech", "ambient", "silent"], "What is heard."),
        music_mood: oneOf(["upbeat", "chill", "sensual", "dramatic", "funny", "none"], "Mood of the music."),
        beat_sync: oneOf(["none", "loose", "tight"], "Do movements or cuts follow the beat?"),
        beat_drop_s: num("Second of a beat drop or striking audio moment, or null."),
        spoken_first_words: text("First words spoken, verbatim, or null."),
        overlay: flag("Is there on-screen text?"),
        overlay_text: text("The on-screen text, verbatim, or null."),
        overlay_position: oneOf(["top", "middle", "bottom", "none"], "Where the text sits."),
        overlay_type: oneOf(["question", "statement", "pov", "relatable", "cta", "none"], "Kind of on-screen text."),
        caption_style: oneOf(["none", "short_tease", "question", "relatable", "pov", "cta", "emoji_only", "long"], "Style of the caption given in the prompt."),
        caption_has_question: flag("Does the caption ask something?"),
        caption_has_cta: flag("Does the caption ask for an action (follow, comment, link)?"),
        caption_emojis: num("Number of emojis in the caption."),
      },
      required: ["audio", "music_mood", "beat_sync", "beat_drop_s", "spoken_first_words", "overlay", "overlay_text", "overlay_position", "overlay_type", "caption_style", "caption_has_question", "caption_has_cta", "caption_emojis"],
    },
  },
  required: ["summary", "visual", "hook", "outfit", "movement", "structure", "audio_text"],
} as const;

export type ReelFeatures = {
  summary: string;
  visual: Record<string, string | null>;
  hook: { first_frame: string; first_seconds: string; hook_type: string; eye_contact_at_start: boolean | null; motion_in_first_frame: boolean | null; strongest_moment_s: number | null; seconds_to_grab: number | null };
  outfit: { category: string; items: string[]; colors: string[]; fit: string; makeup: string; hair: string; accessories: string[]; notable: string | null };
  movement: { pose: string; body_language: string; energy: string; moves: string[]; direction: string; interacts_with: string[]; staging: string };
  structure: { duration_s: number | null; scenes: number | null; cuts: number | null; cut_pace: string; sequence: string; loop_potential: string; ending: string; repeats: boolean | null };
  audio_text: Record<string, string | number | boolean | null>;
};

/** What the comments under a reel say, read by Claude. */
export type CommentRead = {
  themes: string[];
  questions: string[];
  compliments: string[];
  reacting_to: string[];
  emotions: string[];
  shareable_moments: string[];
};

/** Free-text fields: read on the page, never counted. */
const UNCOUNTED = new Set([
  "summary", "visual.location_detail", "hook.first_frame", "hook.first_seconds", "outfit.notable",
  "structure.sequence", "audio_text.spoken_first_words", "audio_text.overlay_text",
]);

/** Numbers are counted in bands that mean something to someone shooting. */
const BANDS: Record<string, { max: number; label: string }[]> = {
  "structure.duration_s": [{ max: 7, label: "≤7s" }, { max: 12, label: "8–12s" }, { max: 20, label: "13–20s" }, { max: 40, label: "21–40s" }, { max: Infinity, label: ">40s" }],
  "structure.cuts": [{ max: 0, label: "0" }, { max: 3, label: "1–3" }, { max: 8, label: "4–8" }, { max: Infinity, label: "9+" }],
  "structure.scenes": [{ max: 1, label: "1" }, { max: 3, label: "2–3" }, { max: Infinity, label: "4+" }],
  "hook.seconds_to_grab": [{ max: 0.5, label: "instant" }, { max: 1.5, label: "≤1.5s" }, { max: 3, label: "≤3s" }, { max: Infinity, label: ">3s" }],
  "hook.strongest_moment_s": [{ max: 1, label: "first second" }, { max: 3, label: "1–3s" }, { max: 7, label: "3–7s" }, { max: Infinity, label: "later" }],
  "audio_text.beat_drop_s": [{ max: 2, label: "≤2s" }, { max: 6, label: "2–6s" }, { max: Infinity, label: ">6s" }],
  "audio_text.caption_emojis": [{ max: 0, label: "0" }, { max: 2, label: "1–2" }, { max: Infinity, label: "3+" }],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A reel as the set of things that can be counted: "visual.location=bathroom",
 * "outfit.accessories∋hairband", "hook.eye_contact_at_start=yes",
 * "structure.duration_s=8–12s". Unclear and empty values are left out, so an
 * unclear reel neither counts for nor against a feature.
 */
export function featureKeys(f: ReelFeatures): Set<string> {
  const out = new Set<string>();
  for (const [section, fields] of Object.entries(f)) {
    if (section === "summary" || !fields || typeof fields !== "object") continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      const key = `${section}.${field}`;
      if (UNCOUNTED.has(key) || value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) if (typeof v === "string" && v.trim() && v !== "none") out.add(`${key}∋${norm(v)}`);
      } else if (typeof value === "boolean") {
        out.add(`${key}=${value ? "yes" : "no"}`);
      } else if (typeof value === "number") {
        const band = BANDS[key]?.find((b) => value <= b.max);
        if (band) out.add(`${key}=${band.label}`);
      } else if (typeof value === "string" && value !== U && value.trim()) {
        out.add(`${key}=${norm(value)}`);
      }
    }
  }
  return out;
}

/** The same keys for what the comments react to, prefixed so they stay apart. */
export function commentKeys(c: CommentRead | null): Set<string> {
  const out = new Set<string>();
  if (!c) return out;
  for (const t of c.themes ?? []) out.add(`comments.theme∋${norm(t)}`);
  for (const t of c.reacting_to ?? []) out.add(`comments.reacting_to∋${norm(t)}`);
  for (const t of c.emotions ?? []) out.add(`comments.emotion∋${norm(t)}`);
  return out;
}

/** "outfit.accessories∋hairband" → "Accessory: hairband", for the page and the briefing. */
export function describeKey(key: string): string {
  const m = key.match(/^([a-z_]+)\.([a-z_0-9]+)(=|∋)(.+)$/);
  if (!m) return key;
  const [, section, field, , value] = m;
  const label = FIELD_LABELS[`${section}.${field}`] ?? field.replace(/_/g, " ");
  return `${label}: ${value.replace(/_/g, " ")}`;
}

const FIELD_LABELS: Record<string, string> = {
  "visual.face_visible": "Face visible",
  "visual.shot_size": "Shot",
  "visual.camera_angle": "Camera angle",
  "visual.gaze": "Gaze",
  "visual.lighting": "Light",
  "visual.palette": "Colours",
  "visual.aesthetic": "Look",
  "visual.location": "Location",
  "visual.camera_motion": "Camera",
  "hook.hook_type": "Hook",
  "hook.eye_contact_at_start": "Eye contact at start",
  "hook.motion_in_first_frame": "Motion in first frame",
  "hook.strongest_moment_s": "Strongest moment",
  "hook.seconds_to_grab": "Grabs within",
  "outfit.category": "Outfit",
  "outfit.items": "Clothing",
  "outfit.colors": "Outfit colour",
  "outfit.fit": "Fit",
  "outfit.makeup": "Make-up",
  "outfit.hair": "Hair",
  "outfit.accessories": "Accessory",
  "movement.pose": "Pose",
  "movement.body_language": "Body language",
  "movement.energy": "Energy",
  "movement.moves": "Move",
  "movement.direction": "Direction",
  "movement.interacts_with": "Plays with",
  "movement.staging": "Staging",
  "structure.duration_s": "Length",
  "structure.scenes": "Scenes",
  "structure.cuts": "Cuts",
  "structure.cut_pace": "Cut pace",
  "structure.loop_potential": "Loop potential",
  "structure.ending": "Ending",
  "structure.repeats": "Repeats a move",
  "audio_text.audio": "Audio",
  "audio_text.music_mood": "Music mood",
  "audio_text.beat_sync": "On the beat",
  "audio_text.beat_drop_s": "Beat drop",
  "audio_text.overlay": "Text overlay",
  "audio_text.overlay_position": "Text position",
  "audio_text.overlay_type": "Text type",
  "audio_text.caption_style": "Caption",
  "audio_text.caption_has_question": "Caption asks",
  "audio_text.caption_has_cta": "Caption CTA",
  "audio_text.caption_emojis": "Caption emojis",
  "comments.theme": "Comments talk about",
  "comments.reacting_to": "Viewers react to",
  "comments.emotion": "Comment mood",
};
