"use client";

import { useEffect } from "react";
import type { GateCopy } from "@/lib/funnel-i18n";

/**
 * The gate: one button that leads to the real page in the real browser.
 *
 * On load the page asks the app for the external browser, pointing at the
 * real page — Instagram and Threads through their own deep link, Android
 * through an intent for Chrome. A tap on the button asks again. Held, the
 * button is a plain link to the real page, so the app's own menu offers
 * "Open Link" and the preview shows nothing but our page.
 */
export function GateClient({
  openUrl,
  copy,
  breakout,
  preview = false,
}: {
  openUrl: string;
  copy: GateCopy;
  breakout: boolean;
  /** In the editor: drawn, but never asks the app or leaves. */
  preview?: boolean;
}) {
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
    if (breakout && !preview) location.replace(outside(openUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUrl, breakout, preview]);

  return (
    <div style={{ marginTop: 18 }}>
      <a
        href={openUrl}
        onClick={(e) => {
          if (preview) return e.preventDefault();
          if (!breakout) return;
          e.preventDefault();
          location.replace(outside(openUrl));
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
        {copy.hold}
      </a>
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,.6)" }}>{copy.hint}</p>
    </div>
  );
}
