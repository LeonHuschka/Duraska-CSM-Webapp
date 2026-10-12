/**
 * The words on the gate page, in the phone's language. The hint names the
 * entry the in-app browser's press-and-hold menu actually shows, so the
 * fan reads the same words twice.
 */
export type GateCopy = { hold: string; hint: string; menu: string; open: string };

const COPY: Record<string, GateCopy> = {
  en: { hold: "👆🏼 Press and hold to open", hint: "Press and hold, then choose “Open Link”.", menu: "Open Link", open: "Open" },
  de: { hold: "👆🏼 Zum Öffnen gedrückt halten", hint: "Gedrückt halten und dann „Link öffnen“ wählen.", menu: "Link öffnen", open: "Öffnen" },
  fr: { hold: "👆🏼 Maintenir pour ouvrir", hint: "Appuyez longuement, puis choisissez « Ouvrir le lien ».", menu: "Ouvrir le lien", open: "Ouvrir" },
  es: { hold: "👆🏼 Mantén pulsado para abrir", hint: "Mantén pulsado y elige “Abrir enlace”.", menu: "Abrir enlace", open: "Abrir" },
  it: { hold: "👆🏼 Tieni premuto per aprire", hint: "Tieni premuto, poi scegli “Apri link”.", menu: "Apri link", open: "Apri" },
  nl: { hold: "👆🏼 Houd vast om te openen", hint: "Houd ingedrukt en kies “Link openen”.", menu: "Link openen", open: "Openen" },
  pt: { hold: "👆🏼 Segure para abrir", hint: "Toque e segure, depois escolha “Abrir link”.", menu: "Abrir link", open: "Abrir" },
};

export function gateCopy(acceptLanguage: string | null): GateCopy {
  const first = (acceptLanguage ?? "").split(",")[0].trim().slice(0, 2).toLowerCase();
  return COPY[first] ?? COPY.en;
}

export function gateLang(acceptLanguage: string | null): string {
  const first = (acceptLanguage ?? "").split(",")[0].trim().slice(0, 2).toLowerCase();
  return COPY[first] ? first : "en";
}
