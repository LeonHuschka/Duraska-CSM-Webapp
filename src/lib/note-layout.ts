/**
 * The note under an inspo video, laid out the same way every time so the
 * model sees at a glance what to do: the set-up first (scene, light,
 * outfit, accessories), then the reel in order (hook, tension, reward),
 * each under its own heading. Notes come written as "• SCENE - …",
 * "1. HOOK - …" or "Hook: …"; a line without a label stays a plain point
 * at the end; a label not known here counts when written in capitals
 * ("NOTE - …"). A note with no labels at all is left as it was written.
 *
 * Works on Telegram HTML (see entitiesToHtml); formatting inside a line
 * is kept.
 */
type Kind = { title: string; emoji: string; words: string[] };

const KINDS: Kind[] = [
  { title: "Scene", emoji: "📍", words: ["scene", "scenery", "setting", "location", "place", "background", "room"] },
  { title: "Light", emoji: "💡", words: ["light", "lights", "lighting", "led"] },
  { title: "Outfit", emoji: "👗", words: ["clothing", "clothes", "cloth", "outfit", "outfits", "dress", "wear"] },
  { title: "Accessories", emoji: "🎀", words: ["accessory", "accessories", "prop", "props"] },
  { title: "Look", emoji: "💄", words: ["hair", "makeup", "make up", "look", "nails"] },
  { title: "Camera", emoji: "🎥", words: ["camera", "angle", "shot", "framing", "cut", "cuts"] },
  { title: "Hook", emoji: "🪝", words: ["hook", "start", "beginning", "intro"] },
  { title: "Tension", emoji: "⏳", words: ["tension", "middle", "build up", "buildup"] },
  { title: "Reward", emoji: "🎁", words: ["reward", "payoff", "pay off", "ending", "end", "outro"] },
  { title: "Text", emoji: "💬", words: ["text", "caption", "overlay", "on screen text"] },
  { title: "Audio", emoji: "🎵", words: ["audio", "sound", "song", "music"] },
];

const BULLET = /^(?:<[^>]+>)*\s*(?:[•·▪◦*\-–]|\d{1,2}[.)])\s*/;
const TAGS = /<[^>]+>/g;
// "SCENE - …", "Hook: …", "<b>HOOK</b> – …": a short label, then the point.
// A dash only with a space beside it, so "LED-light" is no label.
const LABELLED = /^((?:<[^>]+>)*)\s*([A-Za-z][A-Za-z &/]{1,24}?)((?:<\/[^>]+>)*)(?:\s*:\s*|\s+[-–—]\s*|\s*[-–—]\s+)(.+)$/;

const cap = (t: string) => t.replace(/^((?:<[^>]+>)*)([a-z])/, (_, tags: string, c: string) => tags + c.toUpperCase());

export function layoutNote(note: string): string {
  const lines = note
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.replace(TAGS, "").trim());
  const sections = new Map<string, { head: string; points: string[] }>();
  const loose: string[] = [];
  let last: string[] | null = null;
  let labelled = 0;

  for (const raw of lines) {
    const bullet = BULLET.test(raw.replace(TAGS, ""));
    const line = raw.replace(/^((?:<[^>]+>)*)\s*(?:[•·▪◦*\-–]|\d{1,2}[.)])\s*/, "$1");
    const m = line.match(LABELLED);
    const label = m?.[2].trim().toLowerCase() ?? "";
    const kind = KINDS.find((k) => k.words.includes(label));
    // A label of its own only when it is written as one: in capitals.
    if (m && (kind || (m[2] === m[2].toUpperCase() && m[2].trim().length >= 3))) {
      const head = kind ? `${kind.emoji} <b>${kind.title}</b>` : `▫️ <b>${cap(label)}</b>`;
      const key = kind?.title ?? label;
      // Tags opened before the label close after it; the point keeps the rest.
      const point = cap(`${m[1] && !m[3] ? m[1] : ""}${m[4].trim()}`);
      const s = sections.get(key) ?? { head, points: [] };
      s.points.push(point);
      sections.set(key, s);
      last = s.points;
      labelled++;
      continue;
    }
    // A line that goes on from the point above stays with it.
    if (!bullet && last) last[last.length - 1] += `\n${line}`;
    else {
      loose.push(cap(line));
      last = null;
    }
  }
  if (!labelled) return note;

  const order = (key: string) => {
    const i = KINDS.findIndex((k) => k.title === key);
    return i < 0 ? KINDS.length : i;
  };
  const blocks = Array.from(sections.entries())
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([, s]) => `${s.head}\n${s.points.length === 1 ? s.points[0] : s.points.map((p) => `• ${p}`).join("\n")}`);
  if (loose.length) blocks.push(`📝 <b>Also</b>\n${loose.map((p) => `• ${p}`).join("\n")}`);
  return blocks.join("\n\n");
}
