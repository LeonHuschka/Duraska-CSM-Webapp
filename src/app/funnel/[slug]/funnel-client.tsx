"use client";

import { useEffect, useState } from "react";

/**
 * The picture card that is the button, and the way out of the in-app
 * browser.
 *
 * Instagram opens links in its own browser, where every tap is watched
 * and sessions do not carry over. On Android the page can hand itself to
 * Chrome on its own; on iPhone the person has to agree, so they see a
 * screen for it first. The card's address is fetched after load so it is
 * never in the HTML, and it only ever points at this site.
 */
export function FunnelClient({
  base,
  label,
  image,
  ageGate,
  breakout,
}: {
  base: string;
  label: string;
  image: string | null;
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

  const card = (
    <button
      type="button"
      onClick={go}
      disabled={!href}
      aria-label={label}
      style={{
        marginTop: 14,
        display: "block",
        width: "100%",
        aspectRatio: "4 / 3",
        position: "relative",
        border: 0,
        padding: 0,
        borderRadius: 18,
        overflow: "hidden",
        background: "#1a1a1a",
        cursor: href ? "pointer" : "default",
        boxShadow: "0 10px 30px rgba(0,0,0,.5)",
      }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <span
        style={{
          position: "absolute",
          inset: "auto 0 0 0",
          height: "45%",
          background: "linear-gradient(to top, rgba(0,0,0,.85), transparent)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 12,
          textAlign: "center",
          color: "#fff",
          fontSize: 17,
          fontWeight: 700,
          textShadow: "0 1px 8px rgba(0,0,0,.6)",
        }}
      >
        {label}
      </span>
    </button>
  );

  if (gate) {
    return (
      <div style={{ marginTop: 16 }}>
        <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>This page is for adults only. Are you 18 or older?</p>
        <button
          type="button"
          onClick={() => href && (location.href = href)}
          style={{ width: "100%", border: 0, borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 700, background: "#fff", color: "#000" }}
        >
          Yes, I am 18+
        </button>
        <button
          type="button"
          onClick={() => history.back()}
          style={{ marginTop: 8, width: "100%", border: 0, borderRadius: 14, padding: "12px", fontSize: 14, background: "rgba(255,255,255,.12)", color: "#fff" }}
        >
          No
        </button>
      </div>
    );
  }

  if (inApp === "ios") {
    const here = typeof location !== "undefined" ? location.href : "";
    return (
      <div style={{ marginTop: 14 }}>
        <a
          href={`x-safari-${here}`}
          style={{
            display: "block",
            borderRadius: 14,
            padding: "14px 18px",
            fontSize: 15,
            fontWeight: 700,
            background: "#fff",
            color: "#000",
            textDecoration: "none",
          }}
        >
          Open in Safari to continue
        </a>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,.7)" }}>
          or tap <b>···</b> at the top right and choose <b>Open in browser</b>
        </p>
        {card}
      </div>
    );
  }

  return card;
}
