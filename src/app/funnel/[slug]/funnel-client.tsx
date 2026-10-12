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
  // On iPhone the page asks Instagram for Safari once, on load. Whoever
  // says no to that dialog stays here, and the card then goes to the
  // destination inside the app without asking again.
  const [declined, setDeclined] = useState(false);

  // How to ask the app for the real browser. Instagram and Threads each
  // have a deep link for exactly that; it is what brings up "this web page
  // is trying to open an app outside of Instagram — Open / Cancel". Other
  // in-app browsers only understand the x-safari scheme, when they do.
  const outside = (target: string) => {
    const ua = navigator.userAgent;
    if (/\bInstagram\b/i.test(ua)) return `instagram://extbrowser/?url=${encodeURIComponent(target)}`;
    if (/\bThreads\b|\bBarcelona\b/i.test(ua)) return `barcelona://extbrowser/?url=${encodeURIComponent(target)}`;
    return `x-safari-${target}`;
  };

  useEffect(() => {
    const ua = navigator.userAgent;
    const isInApp = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bBarcelona\b|\bTikTok\b|\bBytedance\b|\bSnapchat\b/i.test(ua);
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
        if (!j || typeof j.href !== "string") return;
        setHref(j.href);
        // Instagram's browser on iPhone shows "open an app outside of
        // Instagram?" for a location change to the x-safari scheme (not
        // for a tapped link). Straight to the destination: one "Open" and
        // the fan is in Safari on the real page. Nothing happening after a
        // moment means they said no, or this Instagram ignores the scheme.
        if (breakout && isInApp && ios && !ageGate) {
          const target = new URL(j.href, location.href).toString();
          location.replace(outside(target));
          setTimeout(() => {
            if (document.visibilityState === "visible") setDeclined(true);
          }, 1500);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, breakout, ageGate]);

  const leave = () => {
    if (!href) return;
    const target = new URL(href, location.href).toString();
    if (inApp === "ios" && !declined) {
      // The dialog has not been answered with no yet: ask once more, and
      // fall back to the app's own browser if nothing happens.
      location.replace(outside(target));
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          setDeclined(true);
          location.href = target;
        }
      }, 900);
      return;
    }
    location.href = target;
  };

  const go = () => {
    if (!href) return;
    if (ageGate && !gate) {
      setGate(true);
      return;
    }
    leave();
  };

  const target = href ? new URL(href, typeof location !== "undefined" ? location.href : "https://x/").toString() : undefined;
  const card = (
    <a
      href={target ?? "#"}
      onClick={(e) => {
        e.preventDefault();
        go();
      }}
      aria-label={label}
      aria-disabled={!href}
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

  if (inApp === "ios") {
    return (
      <div>
        {card}
        {declined && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,.6)" }}>
            For the best experience: press and hold the picture, then choose <b>Open Link</b>
          </p>
        )}
      </div>
    );
  }

  return card;
}
