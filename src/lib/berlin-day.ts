/** The Berlin calendar day of a moment, as "YYYY-MM-DD" — the day the team means. */
const berlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
export const berlinDay = (d: Date | string) => berlin.format(typeof d === "string" ? new Date(d) : d);
