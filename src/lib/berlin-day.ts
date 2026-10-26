/**
 * The Berlin calendar day of a moment, as "YYYY-MM-DD" — the day the team
 * means. Built from the parts, not from a locale's own format: Safari
 * writes "en-CA" differently from Node and Chrome.
 */
const berlin = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const berlinDay = (d: Date | string) => {
  const parts = berlin.formatToParts(typeof d === "string" ? new Date(d) : d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
