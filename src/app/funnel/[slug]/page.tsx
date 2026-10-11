import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPage, logEvent, readVisitor } from "@/lib/funnel";
import { totalFollowers } from "@/lib/funnel-dashboard";
import { FunnelClient } from "./funnel-client";

/**
 * The link-in-bio page, as a crawler sees it: a cover, a name, a handle,
 * a follower count, a line, and one picture card with no address on it.
 * The address arrives after the page has loaded, through a request a
 * crawler would have to execute script to make, and even then it only
 * points back at this site. The destination never leaves the server.
 */
export const dynamic = "force-dynamic";

export default async function FunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "";
  const page = await findPage(host, slug === "_" ? null : slug);
  if (!page) notFound();

  const req = new Request(`https://${host}/${slug}`, { headers: h });
  const visitor = readVisitor(req);
  const [followers] = await Promise.all([
    page.show_followers ? totalFollowers(createAdminClient(), page.persona_id) : Promise.resolve(null),
    logEvent(page, visitor, "view"),
  ]);

  const base = `/api/funnel/${page.id}`;
  const nf = new Intl.NumberFormat("en-US");
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#000",
        color: "#fff",
        display: "flex",
        justifyContent: "center",
        fontFamily: "Inter, ui-sans-serif, -apple-system, system-ui, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480, minHeight: "100dvh", background: "#000", position: "relative" }}>
        {/* Cover, fading into black so the name sits on the picture. */}
        <div style={{ position: "relative", aspectRatio: "1 / 1", background: "#111" }}>
          {page.cover_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${base}/cover`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
            {page.handle && (
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "rgba(255,255,255,.65)" }}>
                @{page.handle.replace(/^@/, "")}
              </p>
            )}
            {page.instagram_url && (
              <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 10 }}>
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
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 12px 28px", textAlign: "center" }}>
          {page.show_followers && followers != null && (
            <p style={{ margin: 0, fontSize: 15 }}>
              <b>{nf.format(followers)}</b> <span style={{ color: "rgba(255,255,255,.8)" }}>Total Followers</span>
            </p>
          )}
          {page.bio_line && <p style={{ margin: "14px 0 0", fontSize: 14 }}>{page.bio_line}</p>}

          <FunnelClient
            base={base}
            label={page.button_label}
            image={page.button_image_path ? `${base}/button` : page.cover_path ? `${base}/cover` : null}
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
  // Instagram's own verified mark: a blue seal with a white check.
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
