const NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/** "DE" → "Germany"; the code itself when the runtime does not know it. */
export function countryName(code: string): string {
  try {
    return NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
