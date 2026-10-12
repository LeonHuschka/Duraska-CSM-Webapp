"use client";

import { useEffect, useState } from "react";

/**
 * The picture card that is the button, and the way out of the in-app
 * browser.
 *
 * Instagram opens links in its own browser, where every address the page
 * goes to is Meta's to see. So inside that browser the destination is
 * never opened. The page asks the app for the real browser instead —
 * Instagram and Threads have a deep link for exactly that, Android takes
 * an intent for Chrome — pointing straight at the redirect, so one "Open"
 * puts the fan on the real page in Safari or Chrome. Whoever says no can
 * press and hold the card and choose Open Link, which the app hands to the
 * browser as well. The card's address is fetched after load so it is never
 * in the HTML, and it only ever points at this site.
 */
type Env = "ios-app" | "android-app" | "browser";

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
  const [target, setTarget] = useState<string | null>(null);
  const [env, setEnv] = useState<Env>("browser");
  const [gate, setGate] = useState(false);
  const [asked, setAsked] = useState(false);

  const environment = (): Env => {
    const ua = navigator.userAgent;
    const inApp = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bBarcelona\b|\bTikTok\b|\bBytedance\b|\bSnapchat\b/i.test(ua);
    if (!inApp) return "browser";
    return /Android/i.test(ua) ? "android-app" : "ios-app";
  };

  // How to ask the app for the real browser, with the redirect as the page
  // to open there.
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
    const e = environment();
    setEnv(e);
    fetch(`${base}/config`, { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || typeof j.href !== "string") return;
        const t = new URL(j.href, location.href).toString();
        setTarget(t);
        // Ask once, on load. Nothing happening after a moment means the fan
        // said no, or this app ignores the scheme; the card then explains.
        if (breakout && e !== "browser" && !ageGate) {
          location.replace(outside(t));
          setTimeout(() => {
            if (document.visibilityState === "visible") setAsked(true);
          }, 1500);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, breakout, ageGate]);

  const leave = () => {
    if (!target) return;
    if (env === "browser" || !breakout) {
      location.href = target;
      return;
    }
    // Inside the app: ask again, never open the destination here.
    location.replace(outside(target));
    setTimeout(() => {
      if (document.visibilityState === "visible") setAsked(true);
    }, 1200);
  };

  const go = () => {
    if (!target) return;
    if (ageGate && !gate) {
      setGate(true);
      return;
    }
    leave();
  };

  // What the card links to when it is not tapped but previewed or held:
  // inside the app that is this page itself, never the redirect — the
  // app's link preview follows redirects and would show Meta the
  // destination. "Open Link" then opens this page in Safari, where the
  // card goes straight through. In a real browser the link is the redirect.
  const hrefForLink =
    env === "browser" ? (target ?? "#") : typeof location !== "undefined" ? location.href : "#";
  const card = (
    <a
      href={hrefForLink}
      onClick={(e) => {
        e.preventDefault();
        go();
      }}
      aria-label={label}
      aria-disabled={!target}
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
        cursor: target ? "pointer" : "default",
        boxShadow: "0 10px 30px rgba(0,0,0,.5)",
        WebkitTouchCallout: "default",
      }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
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
    </a>
  );

  if (gate) {
    return (
      <div style={{ marginTop: 16 }}>
        <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>This page is for adults only. Are you 18 or older?</p>
        <button
          type="button"
          onClick={leave}
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

  return (
    <div>
      {card}
      {asked && env === "ios-app" && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,.6)" }}>
          Press and hold the picture, then choose <b>Open Link</b> — or tap <b>···</b> top right and <b>Open in browser</b>
        </p>
      )}
      {asked && env === "android-app" && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,.6)" }}>
          Tap <b>⋮</b> top right and choose <b>Open in Chrome</b>
        </p>
      )}
    </div>
  );
}
