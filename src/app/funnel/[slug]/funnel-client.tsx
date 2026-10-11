"use client";

import { useEffect, useState } from "react";

/**
 * The button, and the way out of the in-app browser.
 *
 * Instagram opens links in its own browser, where every tap is watched
 * and sessions do not carry over. On Android the page can hand itself to
 * Chrome on its own; on iPhone the person has to agree, so they see a
 * screen for it first. The button's address is fetched after load so it is
 * never in the HTML, and it only ever points at this site.
 */
export function FunnelClient({
  base,
  label,
  bg,
  fg,
  ageGate,
  breakout,
}: {
  base: string;
  label: string;
  bg: string;
  fg: string;
  ageGate: boolean;
  breakout: boolean;
}) {
  const [href, setHref] = useState<string | null>(null);
  const [inApp, setInApp] = useState<null | "ios" | "android">(null);
  const [gate, setGate] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isInApp = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bTikTok\b|\bBytedance\b|\bSnapchat\b/i.test(ua);
    const ios = /iPhone|iPad|iPod/i.test(ua);
    const android = /Android/i.test(ua);
    if (breakout && isInApp && android) {
      // Chrome takes an intent link straight from the in-app browser.
      const u = new URL(location.href);
      location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
      setInApp("android");
    } else if (breakout && isInApp && ios) {
      setInApp("ios");
    }
    fetch(`${base}/config`, { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.href === "string") setHref(j.href);
      })
      .catch(() => {});
  }, [base, breakout]);

  const go = () => {
    if (!href) return;
    if (ageGate && !gate) {
      setGate(true);
      return;
    }
    location.href = href;
  };

  const button = (
    <button
      type="button"
      onClick={go}
      disabled={!href}
      style={{
        marginTop: 16,
        width: "100%",
        border: 0,
        borderRadius: 14,
        padding: "15px 18px",
        fontSize: 16,
        fontWeight: 700,
        background: bg,
        color: fg,
        cursor: href ? "pointer" : "default",
        opacity: href ? 1 : 0.85,
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
      }}
    >
      {label}
    </button>
  );

  if (gate) {
    return (
      <div style={{ marginTop: 16 }}>
        <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>This page is for adults only. Are you 18 or older?</p>
        <button
          type="button"
          onClick={() => href && (location.href = href)}
          style={{ width: "100%", border: 0, borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 700, background: bg, color: fg }}
        >
          Yes, I am 18+
        </button>
        <button
          type="button"
          onClick={() => history.back()}
          style={{ marginTop: 8, width: "100%", border: 0, borderRadius: 14, padding: "12px", fontSize: 14, background: "#00000014", color: "inherit" }}
        >
          No
        </button>
      </div>
    );
  }

  if (inApp === "ios") {
    const here = typeof location !== "undefined" ? location.href : "";
    return (
      <div style={{ marginTop: 16 }}>
        <a
          href={`x-safari-${here}`}
          style={{
            display: "block",
            borderRadius: 14,
            padding: "15px 18px",
            fontSize: 16,
            fontWeight: 700,
            background: bg,
            color: fg,
            textDecoration: "none",
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          Open in Safari to continue
        </a>
        <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.7 }}>
          or tap <b>···</b> at the top right and choose <b>Open in browser</b>
        </p>
        <div style={{ marginTop: 14, opacity: 0.8 }}>{button}</div>
      </div>
    );
  }

  return button;
}
