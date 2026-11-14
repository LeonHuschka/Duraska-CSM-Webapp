/**
 * A cell's brief as points, the way the SHOOTING list in Telegram shows
 * it: one point a line, with whatever bullet or number she typed taken off.
 */
export function briefPoints(brief: string | null | undefined): string[] {
  return (brief ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[•\-*–]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}
