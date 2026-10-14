"use client";

import { useEffect, useRef, useState } from "react";
import type { GateCopy } from "@/lib/funnel-i18n";

/**
 * The gate's button. The HTML it comes in is the same for everyone — a
 * button that links nowhere — and the real page's address is never in it.
 * It is asked for at runtime, from the key endpoint, which hands it out
 * only to a visitor that looks like a person on a phone and is not on
 * Meta's network. Then:
 *
 *   in the Instagram app   the key is fetched on load, the button becomes
 *                          a link to the real page (so press-and-hold and
 *                          "Open Link" work), and the app is asked once to
 *                          open it in the real browser
 *   in a real browser      the key is fetched on the first touch of the
 *                          button, and a tap goes to the real page
 *
 * A crawler, even one that runs the script, has no finger: nothing it does
 * on load produces an address unless it also claims to be the Instagram
 * app — and then the key endpoint still has its say.
 */
const IN_APP = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bBarcelona\b|\bTikTok\b|\bBytedance\b|\bSnapchat\b/i;

export function GateClient({
  base,
  slug,
  copy,
  breakout,
  preview = false,
}: {
  base: string;
  /** The address this gate was reached through. */
  slug: string;
  copy: GateCopy;
  breakout: boolean;
  /** In the editor: drawn, but never asks for a key or leaves. */
  preview?: boolean;
}) {
  const [href, setHref] = useState("#");
  const [inApp, setInApp] = useState(true);
  const key = useRef<Promise<string | null> | null>(null);

  const fetchKey = (): Promise<string | null> => {
    if (preview) return Promise.resolve(null);
    key.current ??= fetch(`${base}/key?s=${encodeURIComponent(slug)}`, { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok && r.status === 200 ? r.json() : null))
      .then((j) => (j && typeof j.u === "string" ? j.u : null))
      .catch(() => null);
    return key.current;
  };

  const outside = (t: string): string => {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      const u = new URL(t);
      return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
    }
    if (/\bInstagram\b/i.test(ua)) return `instagram://extbrowser/?url=${encodeURIComponent(t)}`;
    if (/\bThreads\b|\bBarcelona\b/i.test(ua)) return `barcelona://extbrowser/?url=${encodeURIComponent(t)}`;
    return `x-safari-${t}`;
  };

  useEffect(() => {
    if (preview) return;
    const app = IN_APP.test(navigator.userAgent);
    setInApp(app);
    if (!app) return;
    fetchKey().then((u) => {
      if (!u) return;
      setHref(u);
      if (breakout) location.replace(outside(u));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, breakout]);

  const arm = () => {
    if (preview || href !== "#") return;
    fetchKey().then((u) => u && setHref(u));
  };

  return (
    <div style={{ marginTop: 18 }}>
      <a
        href={href}
        onPointerDown={arm}
        onTouchStart={arm}
        onClick={(e) => {
          e.preventDefault();
          if (preview) return;
          fetchKey().then((u) => {
            if (!u) return;
            if (inApp && breakout) location.replace(outside(u));
            else location.href = u;
          });
        }}
        style={{
          display: "block",
          borderRadius: 16,
          padding: "16px 18px",
          fontSize: 17,
          fontWeight: 700,
          background: "#fff",
          color: "#000",
          textDecoration: "none",
          boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          WebkitTouchCallout: "default",
        }}
      >
        {inApp ? copy.hold : copy.open}
      </a>
      {inApp && <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,.6)" }}>{copy.hint}</p>}
    </div>
  );
}
