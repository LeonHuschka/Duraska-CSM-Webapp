"use client";

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
  week,
  month,
}: {
  personaId: string;
  personaName: string;
  page: Page | null;
  coverUrl: string | null;
  week: Stats | null;
  month: Stats | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
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
    enabled: page?.enabled ?? true,
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

  async function upload(file: File) {
    if (!page) {
      toast.error("Save the page first, then add the picture");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `personas/${personaId}/funnel/cover-${Date.now()}.${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("content-assets")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      const res = await setFunnelCover(page.id, path);
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
          <h2 className="text-sm font-semibold">Link in bio</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A page on your own domain with a picture, a name and one button. The destination is never in the
            page&apos;s HTML — it is resolved on the click, after the visitor has been checked for being a
            person. Put the page link in the Instagram bio or on a story sticker; never the destination itself.
          </p>
          {link && (
            <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">
              Your link: <a href={link} target="_blank" rel="noreferrer" className="font-mono text-primary">{link}</a>
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Domain" value={f.domain} onChange={(v) => set("domain", v)} placeholder="sarahprice.link" />
            <Field label="Path" value={f.slug} onChange={(v) => set("slug", v)} placeholder="ig" hint="/ig for Instagram, /tt for TikTok — each path can be its own page later" />
            <Field label="Name on the page" value={f.display_name} onChange={(v) => set("display_name", v)} />
            <Field label="Status line" value={f.status_text} onChange={(v) => set("status_text", v)} hint="With the green dot. Leave empty to hide." />
            <Field label="Text line" value={f.bio_line} onChange={(v) => set("bio_line", v)} />
            <Field label="Button text" value={f.button_label} onChange={(v) => set("button_label", v)} />
          </div>
          <div className="mt-3">
            <Field
              label="Destination (the real link — OnlyFans, Fansly…)"
              value={f.destination_url}
              onChange={(v) => set("destination_url", v)}
              placeholder="https://onlyfans.com/…"
              hint="Stored on the server only. Until this is set the button does nothing."
            />
          </div>
        </section>

        <section className="rounded-xl border border-border/40 bg-card p-5">
          <h2 className="text-sm font-semibold">Look</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Background" value={f.theme_bg} onChange={(v) => set("theme_bg", v)} />
            <Field label="Button" value={f.theme_button_bg} onChange={(v) => set("theme_button_bg", v)} />
            <Field label="Button text" value={f.theme_button_text} onChange={(v) => set("theme_button_text", v)} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="h-28 w-24 overflow-hidden rounded-lg border border-border/40 bg-muted/30">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">no picture</div>
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
                  if (file) upload(file);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading || !page} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "Upload picture"}
              </Button>
              <p className="mt-1 text-[11px] text-muted-foreground">Portrait, roughly 4:5. Keep it safe for work — this page is what Instagram sees.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Toggle label="Verified badge next to the name" checked={f.verified} onChange={(v) => set("verified", v)} />
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
