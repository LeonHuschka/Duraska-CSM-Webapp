import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { findPage, logEvent, readVisitor } from "@/lib/funnel";
import { FunnelClient } from "./funnel-client";

/**
 * The link-in-bio page, as a crawler sees it: a picture, a name, a line,
 * and a button with no address on it. The address arrives after the page
 * has loaded, through a request a crawler would have to execute script to
 * make, and even then it only points back at this site. The destination
 * never leaves the server.
 */
export const dynamic = "force-dynamic";

export default async function FunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug === "_" ? null : slug);
  if (!page) notFound();

  // The server component has no Request; rebuild what readVisitor needs.
  const req = new Request(`https://${host}/${slug}`, { headers: h });
  const visitor = readVisitor(req);
  await logEvent(page, visitor, "view");

  const base = `/api/funnel/${page.id}`;
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: `radial-gradient(120% 80% at 50% 0%, ${page.theme_bg}cc, #1a1a1a 70%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "ui-sans-serif, -apple-system, system-ui, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          borderRadius: 28,
          overflow: "hidden",
          background: page.theme_bg,
          color: "#111",
          boxShadow: "0 30px 80px rgba(0,0,0,.45)",
        }}
      >
        <div style={{ position: "relative", aspectRatio: "9 / 10", background: "#00000022" }}>
          {page.cover_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${base}/cover`}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}
          <div
            style={{
              position: "absolute",
              inset: "auto 0 0 0",
              height: 120,
              background: `linear-gradient(to top, ${page.theme_bg}, transparent)`,
            }}
          />
          <h1
            style={{
              position: "absolute",
              bottom: 8,
              left: 0,
              right: 0,
              margin: 0,
              textAlign: "center",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {page.display_name}
            {page.verified && (
              <svg width="20" height="20" viewBox="0 0 24 24" aria-label="verified">
                <path
                  fill="#3b82f6"
                  d="M12 1.5l2.6 2.1 3.3-.5 1.2 3.1 3 1.5-.6 3.3 2 2.7-2 2.7.6 3.3-3 1.5-1.2 3.1-3.3-.5L12 22.5l-2.6-2.1-3.3.5-1.2-3.1-3-1.5.6-3.3L.5 12l2-2.7-.6-3.3 3-1.5 1.2-3.1 3.3.5z"
                />
                <path d="M7.5 12.2l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </h1>
        </div>

        <div style={{ padding: "14px 20px 22px", textAlign: "center" }}>
          {page.status_text && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 999,
                background: "#00000014",
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#22c55e" }} />
              {page.status_text}
            </span>
          )}
          {page.bio_line && <p style={{ margin: "14px 0 0", fontSize: 15, opacity: 0.9 }}>{page.bio_line}</p>}

          <FunnelClient
            base={base}
            label={page.button_label}
            bg={page.theme_button_bg}
            fg={page.theme_button_text}
            ageGate={page.age_gate}
            breakout={page.breakout}
          />

          {/* Nothing a person can see or tap; only a crawler follows it. */}
          <a
            href={`${base}/c`}
            aria-hidden="true"
            tabIndex={-1}
            rel="nofollow"
            style={{ position: "absolute", left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          >
            {" "}
          </a>

          <p style={{ margin: "26px 0 0", fontSize: 11, opacity: 0.55 }}>
            <a href={`${base}/report`} style={{ color: "inherit", textDecoration: "none" }}>
              Report
            </a>
            <span style={{ margin: "0 8px" }}>·</span>
            <a href={`${base}/privacy`} style={{ color: "inherit", textDecoration: "none" }}>
              Privacy
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
