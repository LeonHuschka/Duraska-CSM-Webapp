import { TelegramIcon, VisitorsToday } from "./telegram";
import { visitorsToday } from "@/lib/funnel-visitors";
/** The fields of a page the head shows. */
export type ShellPage = {
  display_name: string;
  verified: boolean;
  handle: string | null;
  instagram_url: string | null;
  show_followers: boolean;
  bio_line: string;
};

/** Where the Telegram icon leads: straight there, or asked for on the tap. */
export type ShellTelegram = { href: string } | { base: string; slug: string } | null;

/**
 * What both pages share: the cover fading into black, the name with its
 * badge, the handle, the Instagram icon, the follower total and the line.
 * The page's own part — a gate button, or the card — goes underneath.
 * Nothing in here touches the server, so the editor can draw it live.
 */
export function FunnelShell({
  page,
  base,
  followers,
  lang,
  coverSrc,
  fill = "100dvh",
  link = null,
  stat = "followers",
  showBio = true,
  status = "",
  telegram = null,
  preview = false,
  children,
}: {
  page: ShellPage;
  base: string;
  followers: number | null;
  lang: string;
  /** The header picture's address, or none. */
  coverSrc: string | null;
  /** The page's minimum height — the viewport, or the editor's phone frame. */
  fill?: string;
  /** Which of the page's addresses this is, for the canary. */
  link?: string | null;
  /** The line under the head: followers, the visitors counter, or nothing. */
  stat?: "followers" | "visitors" | null;
  showBio?: boolean;
  /** "Available now" with a pulsing green dot, in place of the handle; empty shows the handle. */
  status?: string;
  telegram?: ShellTelegram;
  /** In the editor: drawn, never acting. */
  preview?: boolean;
  children: React.ReactNode;
}) {
  const nf = new Intl.NumberFormat("en-US");
  return (
    <main
      lang={lang}
      style={{
        minHeight: fill,
        background: "#000",
        color: "#fff",
        display: "flex",
        justifyContent: "center",
        fontFamily: "Inter, ui-sans-serif, -apple-system, system-ui, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480, minHeight: fill, background: "#000", position: "relative" }}>
        <div style={{ position: "relative", aspectRatio: "1 / 1", background: "#111" }}>
          {coverSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          )}
          <div
            style={{
              position: "absolute",
              inset: "auto 0 0 0",
              height: "55%",
              background: "linear-gradient(to top, #000 8%, rgba(0,0,0,.75) 45%, transparent)",
            }}
          />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 14, textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {page.display_name}
              {page.verified && <Badge />}
            </h1>
            {/* Page 2 shows "Available now" where page 1 shows the handle. */}
            {status ? (
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 14,
                  color: "rgba(255,255,255,.85)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <span style={{ position: "relative", width: 8, height: 8 }}>
                  <span className="fnl-ping" style={{ position: "absolute", inset: 0, borderRadius: 999, background: "#22c55e" }} />
                  <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "#22c55e" }} />
                </span>
                {status}
              </p>
            ) : page.handle && (
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "rgba(255,255,255,.65)" }}>@{page.handle.replace(/^@/, "")}</p>
            )}
            {(page.instagram_url || telegram) && (
              <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 10 }}>
                {page.instagram_url && (
                <a
                  href={page.instagram_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)",
                  }}
                >
                  <InstagramGlyph />
                </a>
                )}
                {telegram &&
                  ("href" in telegram ? (
                    <TelegramIcon href={telegram.href} preview={preview} />
                  ) : (
                    <TelegramIcon base={telegram.base} slug={telegram.slug} preview={preview} />
                  ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 12px 28px", textAlign: "center" }}>
          {stat === "followers" && page.show_followers && followers != null && (
            <p style={{ margin: 0, fontSize: 15 }}>
              <b>{nf.format(followers)}</b> <span style={{ color: "rgba(255,255,255,.8)" }}>Total Followers</span>
            </p>
          )}
          {stat === "visitors" && <VisitorsToday initial={visitorsToday()} />}
          {showBio && page.bio_line && <p style={{ margin: "14px 0 0", fontSize: 14 }}>{page.bio_line}</p>}

          {children}

          {/* Nothing a person can see or tap; only a crawler follows it. */}
          <a
            href={link ? `${base}/c?s=${encodeURIComponent(link)}` : `${base}/c`}
            aria-hidden="true"
            tabIndex={-1}
            rel="nofollow"
            style={{ position: "absolute", left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          >
            {" "}
          </a>

          <p style={{ margin: "28px 0 0", fontSize: 11, color: "rgba(255,255,255,.55)" }}>
            <a href={`${base}/privacy`} style={{ color: "inherit", textDecoration: "underline" }}>
              Privacy Policy
            </a>
            <span style={{ margin: "0 6px" }}>|</span>
            <a href={`${base}/privacy`} style={{ color: "inherit", textDecoration: "underline" }}>
              Terms
            </a>
            <span style={{ margin: "0 6px" }}>|</span>
            <a href={`${base}/report`} style={{ color: "inherit", textDecoration: "underline" }}>
              Report
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

function Badge() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-label="verified">
      <path
        fill="#0095F6"
        d="M12 1.2l2.45 1.9 3.05-.35 1.1 2.9 2.9 1.1-.35 3.05L23 12l-1.85 2.2.35 3.05-2.9 1.1-1.1 2.9-3.05-.35L12 22.8l-2.45-1.9-3.05.35-1.1-2.9-2.9-1.1.35-3.05L1 12l1.85-2.2-.35-3.05 2.9-1.1 1.1-2.9 3.05.35z"
      />
      <path d="M7.2 12.4l3.1 3.1 6.5-6.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InstagramGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none" />
    </svg>
  );
}
