"use client";

import type { PictureSlot } from "@/app/(app)/settings/funnel/actions";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { saveFunnelPage, setFunnelCover, type FunnelForm } from "@/app/(app)/settings/funnel/actions";
import type { Database } from "@/lib/types/database";
import type { funnelStats } from "@/lib/funnel";

type Page = Database["public"]["Tables"]["funnel_pages"]["Row"];
type Stats = Awaited<ReturnType<typeof funnelStats>>;

const nf = new Intl.NumberFormat("de-DE");

export function FunnelSettings({
  personaId,
  personaName,
  page,
  coverUrl,
  openCoverUrl,
  buttonUrl,
  week,
  month,
}: {
  personaId: string;
  personaName: string;
  page: Page | null;
  coverUrl: string | null;
  openCoverUrl: string | null;
  buttonUrl: string | null;
  week: Stats | null;
  month: Stats | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const buttonFileRef = useRef<HTMLInputElement>(null);
  const openCoverFileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState<FunnelForm>({
    domain: page?.domain ?? "",
    slug: page?.slug ?? "ig",
    display_name: page?.display_name ?? personaName,
    status_text: page?.status_text ?? "Available now",
    bio_line: page?.bio_line ?? "Free for a limited time",
    button_label: page?.button_label ?? "Click to see more ;)",
    destination_url: page?.destination_url ?? "",
    theme_bg: page?.theme_bg ?? "#F4B6C6",
    theme_button_bg: page?.theme_button_bg ?? "#111827",
    theme_button_text: page?.theme_button_text ?? "#ffffff",
    verified: page?.verified ?? true,
    age_gate: page?.age_gate ?? false,
    breakout: page?.breakout ?? true,
    blocked_countries: (page?.blocked_countries ?? []).join(", "),
    ignored_countries: (page?.ignored_countries ?? []).join(", "),
    enabled: page?.enabled ?? true,
    handle: page?.handle ?? "",
    instagram_url: page?.instagram_url ?? "",
    show_followers: page?.show_followers ?? true,
  });
  const set = <K extends keyof FunnelForm>(k: K, v: FunnelForm[K]) => setF((s) => ({ ...s, [k]: v }));

  function save() {
    start(async () => {
      const res = await saveFunnelPage(page?.id ?? null, f);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Saved");
        router.refresh();
      }
    });
  }

  async function upload(file: File, slot: PictureSlot = "cover") {
    if (!page) {
      toast.error("Save the page first, then add the picture");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `personas/${personaId}/funnel/${slot}-${Date.now()}.${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("content-assets")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      const res = await setFunnelCover(page.id, path, slot);
      if (res.error) throw new Error(res.error);
      toast.success("Picture updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const link = f.domain ? `https://${f.domain.replace(/^https?:\/\//, "")}/${f.slug || "ig"}` : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="rounded-xl border border-border/40 bg-card p-5">
          <h2 className="text-sm font-semibold">Link in bio — two pages</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <b>Page 1</b> is the address for Instagram. It carries the picture, the name and one button that
            opens page 2 in the phone&apos;s real browser — in the phone&apos;s language, with the same words
            the press-and-hold menu uses. Nothing about the destination is on it. <b>Page 2</b> is the real
            page with the card; its address is never put on Instagram. A visitor who is already in a real
            browser sees page 2 right away. The destination is resolved only on the click, after the visitor
            has been checked for being a person.
          </p>
          {link && (
            <div className="mt-3 space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <p>
                Page 1 — put this on Instagram:{" "}
                <a href={link} target="_blank" rel="noreferrer" className="font-mono text-primary">{link}</a>
              </p>
              <p>
                Page 2 — the real page:{" "}
                <a href={`${link}/open`} target="_blank" rel="noreferrer" className="font-mono text-primary">{link}/open</a>
              </p>
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Domain" value={f.domain} onChange={(v) => set("domain", v)} placeholder="sarahprice.link" />
            <Field label="Path" value={f.slug} onChange={(v) => set("slug", v)} placeholder="ig" hint="/ig for Instagram, /tt for TikTok — each path can be its own page later" />
            <Field label="Name on the page" value={f.display_name} onChange={(v) => set("display_name", v)} />
            <Field label="Handle under the name" value={f.handle} onChange={(v) => set("handle", v)} placeholder="sarahprice" />
            <Field label="Instagram link (icon under the name)" value={f.instagram_url} onChange={(v) => set("instagram_url", v)} placeholder="https://instagram.com/…" />
            <Field label="Status line" value={f.status_text} onChange={(v) => set("status_text", v)} hint="The pill with the pulsing green dot on page 2's card. Leave empty to hide." />
            <Field label="Text line" value={f.bio_line} onChange={(v) => set("bio_line", v)} />
            <Field label="Card text (page 2)" value={f.button_label} onChange={(v) => set("button_label", v)} hint="The OnlyFans button on the card. Page 1's button is fixed: “Press and hold to open”, in the phone's language." />
          </div>
          <div className="mt-3">
            <Field
              label="Destination (page 2's card — OnlyFans, Fansly…)"
              value={f.destination_url}
              onChange={(v) => set("destination_url", v)}
              placeholder="https://onlyfans.com/…"
              hint="Stored on the server only. Until this is set the button does nothing."
            />
          </div>
        </section>

        <section className="rounded-xl border border-border/40 bg-card p-5">
          <h2 className="text-sm font-semibold">Pictures</h2>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page 1 — what Instagram sees</h3>
          <Picture
            url={coverUrl}
            shape="h-28 w-24"
            fileRef={fileRef}
            busy={uploading}
            disabled={!page}
            onFile={(file) => upload(file, "cover")}
            button="Upload header"
            hint="Square. Keep it safe for work — Meta's crawler and the in-app browser get this picture."
            empty="no picture"
          />
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page 2 — the real page</h3>
          <Picture
            url={openCoverUrl}
            shape="h-28 w-24"
            fileRef={openCoverFileRef}
            busy={uploading}
            disabled={!page}
            onFile={(file) => upload(file, "open_cover")}
            button="Upload header"
            hint="Square. Only seen in the phone's own browser; falls back to page 1's header."
            empty="uses page 1's"
          />
          <Picture
            url={buttonUrl}
            shape="h-20 w-28"
            fileRef={buttonFileRef}
            busy={uploading}
            disabled={!page}
            onFile={(file) => upload(file, "button")}
            button="Upload card picture"
            hint="Landscape, roughly 4:3. The card carries the status pill and the OnlyFans button on top of it."
            empty="uses the header"
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Toggle label="Verified badge next to the name" checked={f.verified} onChange={(v) => set("verified", v)} />
            <Toggle label="Show the follower total from the scraped accounts" checked={f.show_followers} onChange={(v) => set("show_followers", v)} />
            <Toggle label="Pop fans out of the Instagram browser" checked={f.breakout} onChange={(v) => set("breakout", v)} />
            <Toggle label="Ask “18+?” before the redirect" checked={f.age_gate} onChange={(v) => set("age_gate", v)} />
            <Toggle label="Page enabled" checked={f.enabled} onChange={(v) => set("enabled", v)} />
          </div>
          <div className="mt-3">
            <Field
              label="Blocked countries"
              value={f.blocked_countries}
              onChange={(v) => set("blocked_countries", v)}
              placeholder="e.g. DE, AT"
              hint="Two-letter codes. Visitors from these countries see the page but the button leads nowhere."
            />
          </div>
          <div className="mt-3">
            <Field
              label="Left out of the statistics"
              value={f.ignored_countries}
              onChange={(v) => set("ignored_countries", v)}
              placeholder="e.g. HR"
              hint="Two-letter codes. Where you test from — visits and clicks from these countries do not count in the Link tab, past ones included."
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : page ? "Save" : "Create page"}
          </Button>
        </div>
      </div>

      <aside className="space-y-4">
        <StatsCard title="Last 7 days" s={week} />
        <StatsCard title="Last 30 days" s={month} />
      </aside>
    </div>
  );
}

function StatsCard({ title, s }: { title: string; s: Stats | null }) {
  if (!s) {
    return (
      <div className="rounded-xl border border-border/40 bg-card p-4 text-xs text-muted-foreground">
        {title}: no page yet.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["Views", nf.format(s.views)],
          ["Clicks", nf.format(s.clicks)],
          ["CTR", s.ctr == null ? "—" : `${(s.ctr * 100).toFixed(0)}%`],
        ].map(([l, v]) => (
          <div key={l}>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
            <p className="text-[10px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      <dl className="mt-3 space-y-1 text-xs">
        <Row k="From the Instagram browser" v={nf.format(s.inApp)} />
        <Row k="Bots turned away" v={nf.format(s.bots)} />
        <Row k="Caught by the canary" v={nf.format(s.canary)} />
        <Row k="Blocked by country" v={nf.format(s.blocked)} />
      </dl>
      {s.byCountry.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">People by country</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {s.byCountry.map(([c, n]) => (
              <li key={c} className="flex justify-between"><span>{c}</span><span className="tabular-nums text-muted-foreground">{n}</span></li>
            ))}
          </ul>
        </div>
      )}
      {s.botReasons.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Who came knocking</p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {s.botReasons.map(([r, n]) => (
              <li key={r} className="flex justify-between gap-2"><span className="truncate text-muted-foreground">{r}</span><span className="tabular-nums">{n}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function Picture({
  url,
  shape,
  fileRef,
  busy,
  disabled,
  onFile,
  button,
  hint,
  empty,
}: {
  url: string | null;
  shape: string;
  fileRef: React.RefObject<HTMLInputElement>;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  button: string;
  hint: string;
  empty: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <div className={`${shape} overflow-hidden rounded-lg border border-border/40 bg-muted/30`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{empty}</div>
        )}
      </div>
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
          {busy ? "Uploading…" : button}
        </Button>
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
