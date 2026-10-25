"use client";

import { useEffect, useState } from "react";
import { visitorsToday } from "@/lib/funnel-visitors";

/** The Telegram mark: the paper plane on its blue disc. */
export function TelegramGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M5.43 11.87c3.5-1.52 5.83-2.53 7-3.02 3.33-1.39 4.02-1.63 4.47-1.64.1 0 .32.02.47.14.12.1.15.23.17.33.02.1.04.31.02.48-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.91-1.06-.69-1.66-1.12-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.35-.48.33-.91.49-1.3.48-.43-.01-1.25-.24-1.86-.44-.75-.24-1.35-.37-1.3-.79.03-.22.33-.44.89-.67Z"
      />
    </svg>
  );
}

const IN_APP = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bThreads\b|\bBarcelona\b|\bTikTok\b|\bBytedance\b|\bSnapchat\b/i;

/**
 * Open Telegram. Inside an in-app browser the app's own scheme, so the
 * Telegram app opens instead of a web preview inside Instagram.
 */
function openTelegram(u: string, app: string | null) {
  if (app && IN_APP.test(navigator.userAgent)) {
    location.href = app;
    setTimeout(() => {
      if (document.visibilityState === "visible") location.href = u;
    }, 900);
    return;
  }
  window.open(u, "_blank", "noopener");
}

/**
 * The Telegram icon beside Instagram's. On the gate its address is not in
 * the page: it is asked for on the tap, and a crawler — which taps
 * nothing — never learns where it leads.
 */
export function TelegramIcon({ base, slug, href, preview = false }: { base?: string; slug?: string; href?: string | null; preview?: boolean }) {
  return (
    <a
      href={href ?? "#"}
      target={href ? "_blank" : undefined}
      rel="noreferrer"
      aria-label="Telegram"
      onClick={async (e) => {
        if (preview) return e.preventDefault();
        if (href) return;
        e.preventDefault();
        if (!base) return;
        const r = await fetch(`${base}/tg?s=${encodeURIComponent(slug ?? "")}`, { cache: "no-store" }).catch(() => null);
        if (!r || r.status !== 200) return;
        const j = (await r.json().catch(() => null)) as { u?: string; app?: string } | null;
        if (j?.u) openTelegram(j.u, j.app ?? null);
      }}
      style={{ width: 34, height: 34, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      <TelegramGlyph size={34} />
    </a>
  );
}

/** Page 2's second button, under the card. */
export function TelegramButton({ href, label, preview = false }: { href: string; label: string; preview?: boolean }) {
  const app = (() => {
    const m = href.match(/t\.me\/([A-Za-z0-9_]+)/);
    return m ? `tg://resolve?domain=${m[1]}` : null;
  })();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        if (!preview) openTelegram(href, app);
      }}
      style={{
        marginTop: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: "100%",
        padding: "14px 18px",
        borderRadius: 16,
        background: "#1f2230",
        color: "#fff",
        fontSize: 17,
        fontWeight: 700,
        textDecoration: "none",
        boxShadow: "0 10px 30px rgba(0,0,0,.45)",
      }}
    >
      <TelegramGlyph size={22} />
      {label}
    </a>
  );
}

/** "4,533 visitors today", ticking up while the page is open. */
export function VisitorsToday({ initial }: { initial: number }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      setN((x) => Math.max(x, visitorsToday()) + (Math.random() < 0.6 ? 1 : 2));
      setTimeout(step, 2500 + Math.random() * 4500);
    };
    const t = setTimeout(step, 3000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  return (
    <p style={{ margin: 0, fontSize: 15 }}>
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{new Intl.NumberFormat("en-US").format(n)}</b>{" "}
      <span style={{ color: "rgba(255,255,255,.8)" }}>visitors today</span>
    </p>
  );
}
