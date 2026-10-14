"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Plus, Save, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  addFunnelLink,
  removeFunnelLink,
  saveFunnelPage,
  setFunnelCover,
  type FunnelForm,
  type PictureSlot,
} from "@/app/(editor)/link/editor/actions";
import type { Database } from "@/lib/types/database";
import { gateCopy } from "@/lib/funnel-i18n";
import { FunnelShell } from "@/app/funnel/[slug]/shell";
import { GateClient } from "@/app/funnel/[slug]/gate-client";
import { FunnelClient } from "@/app/funnel/[slug]/funnel-client";

type Page = Database["public"]["Tables"]["funnel_pages"]["Row"];
type SiblingLink = { id: string; slug: string; label: string; enabled: boolean };
type Pictures = Record<PictureSlot, string | null>;

const LANGS: [string, string][] = [
  ["de", "Deutsch"],
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["nl", "Nederlands"],
  ["pt", "Português"],
];

/**
 * The form and the phone. The phone draws the real page components from
 * the form's state, so what is typed is what the fan will see; nothing is
 * stored until Save. Pictures show the moment they are picked and upload
 * in the background.
 */
export function LinkEditor({
  personaId,
  personaName,
  page,
  pictures,
  followers,
  links,
}: {
  personaId: string;
  personaName: string;
  page: Page | null;
  pictures: Pictures;
  followers: number | null;
  links: SiblingLink[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<PictureSlot | null>(null);
  const [shown, setShown] = useState<1 | 2>(1);
  const [newLink, setNewLink] = useState({ slug: "", label: "" });
  const [linkBusy, setLinkBusy] = useState(false);
  const [lang, setLang] = useState("de");
  const [pics, setPics] = useState<Pictures>(pictures);
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
  const [saved, setSaved] = useState(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof FunnelForm>(k: K, v: FunnelForm[K]) => setF((s) => ({ ...s, [k]: v }));

  // Fresh signed addresses after a save or upload, without losing the form.
  useEffect(() => setPics(pictures), [pictures]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function save() {
    start(async () => {
      const res = await saveFunnelPage(page?.id ?? null, f);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSaved(f);
      toast.success(page ? "Saved — the page is live with these words" : "Page created");
      router.refresh();
    });
  }

  async function upload(file: File, slot: PictureSlot) {
    if (!page) {
      toast.error("Save the page first, then add the pictures");
      return;
    }
    // On the phone at once; the upload follows.
    const local = URL.createObjectURL(file);
    setPics((p) => ({ ...p, [slot]: local }));
    setUploading(slot);
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
      toast.success("Picture is live");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setPics((p) => ({ ...p, [slot]: pictures[slot] }));
    } finally {
      setUploading(null);
    }
  }

  async function addLink() {
    if (!page) return;
    setLinkBusy(true);
    const res = await addFunnelLink(page.id, newLink.slug, newLink.label);
    setLinkBusy(false);
    if (res.error) return toast.error(res.error);
    setNewLink({ slug: "", label: "" });
    toast.success("Link added — it works right away");
    router.refresh();
  }

  async function removeLink(l: SiblingLink) {
    if (!confirm(`Remove ${l.slug}? Whoever has it in a bio gets a dead link.`)) return;
    const res = await removeFunnelLink(l.id);
    if (res.error) return toast.error(res.error);
    toast.success("Link removed");
    router.refresh();
  }

  const domain = f.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const link = domain ? `https://${domain}/${f.slug || "ig"}` : null;
  const base = page ? `/api/funnel/${page.id}` : "/api/funnel/none";
  const shellPage = {
    display_name: f.display_name,
    verified: f.verified,
    handle: f.handle || null,
    instagram_url: f.instagram_url || null,
    show_followers: f.show_followers,
    bio_line: f.bio_line,
  };
  const cardImage = pics.button ?? pics.cover;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border/40 bg-card/90 px-4 py-2.5 backdrop-blur">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Link in bio — editor</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {link ? (
              <>
                <a href={link} target="_blank" rel="noreferrer" className="font-mono text-primary">
                  {link}
                </a>
                <span> for Instagram · </span>
                <span className="font-mono">{link}/open</span>
                <span> is the real page — it opens only through the gate&apos;s button, never from the address alone</span>
              </>
            ) : (
              "Set a domain to get the links"
            )}
          </p>
        </div>
        <span className={`text-[11px] ${dirty ? "text-amber-400" : "text-muted-foreground"}`}>
          {dirty ? "● unsaved changes" : "everything saved"}
        </span>
        {link && page && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/50 px-3 text-xs hover:bg-muted/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open the page
          </a>
        )}
        <Button size="sm" onClick={save} disabled={pending || (!dirty && !!page)}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {pending ? "Saving…" : page ? "Save" : "Create page"}
        </Button>
      </header>

      <div className="grid flex-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:p-6">
        <div className="space-y-5">
          <Section title="Addresses" lead="The domain and the main path. Page 1 is the path itself, page 2 is the path plus /open.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Domain" value={f.domain} onChange={(v) => set("domain", v)} placeholder="sarahprice.link" />
              <Field label="Main path" value={f.slug} onChange={(v) => set("slug", v)} placeholder="ig" />
            </div>
          </Section>

          <Section
            title="Links — one per account"
            lead="The same page under more addresses, one per account. A flag on Instagram hits one address, not all, and the Link tab shows what each account brings. Links work the moment they are added."
          >
            {links.length > 0 && (
              <ul className="mb-3 divide-y divide-border/40 rounded-lg border border-border/40">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="font-mono text-primary">
                      {domain || "…"}/{l.slug}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.label || "—"}</span>
                    <button
                      type="button"
                      onClick={() => removeLink(l)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                      aria-label={`Remove ${l.slug}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Path" value={newLink.slug} onChange={(v) => setNewLink((s) => ({ ...s, slug: v }))} placeholder="sp3" />
              <Field label="Whose" value={newLink.label} onChange={(v) => setNewLink((s) => ({ ...s, label: v }))} placeholder="Lyza · @sarahpricexo" />
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!page || linkBusy || !newLink.slug.trim()} onClick={addLink}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {linkBusy ? "Adding…" : "Add link"}
              </Button>
            </div>
            {!page && <p className="mt-2 text-[11px] text-muted-foreground">Create the page first, then add links.</p>}
          </Section>

          <Section title="Head — on both pages" lead="The picture fades into black, the name sits on it, the handle and the Instagram icon under it.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={f.display_name} onChange={(v) => set("display_name", v)} />
              <Field label="Handle" value={f.handle} onChange={(v) => set("handle", v)} placeholder="sarahprice" />
              <Field
                label="Instagram link"
                value={f.instagram_url}
                onChange={(v) => set("instagram_url", v)}
                placeholder="https://instagram.com/…"
                hint="The icon under the name. Empty hides it."
              />
              <Field label="Text line" value={f.bio_line} onChange={(v) => set("bio_line", v)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <Toggle label="Verified badge" checked={f.verified} onChange={(v) => set("verified", v)} />
              <Toggle label="Show total followers" checked={f.show_followers} onChange={(v) => set("show_followers", v)} />
            </div>
          </Section>

          <Section
            title="Page 1 — what Instagram sees"
            lead="Everyone gets this page — Meta's crawler, a reviewer, the in-app browser, a fan: the head and one button, in the phone's language. Nothing about the destination is on it, and the real page's address is not in it either."
          >
            <Picture
              label="Header picture"
              url={pics.cover}
              busy={uploading === "cover"}
              disabled={!page}
              onFile={(file) => upload(file, "cover")}
              hint="Square. Keep it safe for work."
              empty="no picture"
            />
          </Section>

          <Section title="Page 2 — the real page" lead="Opens only through the gate's button, in the phone's own browser; its address alone shows the gate again. The card is the button.">
            <Picture
              label="Header picture"
              url={pics.open_cover}
              busy={uploading === "open_cover"}
              disabled={!page}
              onFile={(file) => upload(file, "open_cover")}
              hint="Square. Without one, page 1's header is used."
              empty="uses page 1's"
            />
            <Picture
              label="Card picture"
              url={pics.button}
              busy={uploading === "button"}
              disabled={!page}
              onFile={(file) => upload(file, "button")}
              hint="Landscape, roughly 4:3. Without one, the header is used."
              empty="uses the header"
              wide
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Status pill" value={f.status_text} onChange={(v) => set("status_text", v)} hint="With the pulsing green dot. Empty hides it." />
              <Field label="Button text" value={f.button_label} onChange={(v) => set("button_label", v)} hint="Next to the OnlyFans mark." />
            </div>
            <div className="mt-3">
              <Field
                label="Destination"
                value={f.destination_url}
                onChange={(v) => set("destination_url", v)}
                placeholder="https://onlyfans.com/…"
                hint="Never in the page's HTML — resolved on the click, after the visitor has been checked for being a person."
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <Toggle label="Ask for 18+ before the link" checked={f.age_gate} onChange={(v) => set("age_gate", v)} />
            </div>
          </Section>

          <Section title="Behaviour" lead="How visitors are handled.">
            <div className="flex flex-wrap gap-4">
              <Toggle label="Page is live" checked={f.enabled} onChange={(v) => set("enabled", v)} />
              <Toggle label="Ask the Instagram app for the real browser" checked={f.breakout} onChange={(v) => set("breakout", v)} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Blocked countries"
                value={f.blocked_countries}
                onChange={(v) => set("blocked_countries", v)}
                placeholder="e.g. DE, AT"
                hint="Two-letter codes. They see the page, the button leads nowhere."
              />
              <Field
                label="Left out of the statistics"
                value={f.ignored_countries}
                onChange={(v) => set("ignored_countries", v)}
                placeholder="e.g. HR"
                hint="Where you test from. Not counted in the Link tab."
              />
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-16 lg:self-start">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setShown(n)}
                  className={`rounded-md px-3 py-1 text-[11px] transition-colors ${
                    shown === n ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Page {n}
                </button>
              ))}
            </div>
            {shown === 1 ? (
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="h-7 rounded-md border border-border/50 bg-card px-2 text-[11px]"
                aria-label="Phone language"
              >
                {LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Smartphone className="h-3 w-3" /> in Safari or Chrome
              </span>
            )}
          </div>

          <div className="mx-auto w-[375px] max-w-full overflow-hidden rounded-[44px] border-[10px] border-neutral-900 bg-black shadow-2xl">
            <div className="h-[720px] overflow-y-auto overscroll-contain [scrollbar-width:none]">
              {shown === 1 ? (
                <FunnelShell page={shellPage} base={base} followers={followers} lang={lang} coverSrc={pics.cover} fill="100%">
                  <GateClient base={base} slug={f.slug || "ig"} copy={gateCopy(lang)} breakout={f.breakout} preview />
                </FunnelShell>
              ) : (
                <FunnelShell page={shellPage} base={base} followers={followers} lang={lang} coverSrc={pics.open_cover ?? pics.cover} fill="100%">
                  <FunnelClient
                    base={base}
                    slug={f.slug || "ig"}
                    k={null}
                    label={f.button_label}
                    status={f.status_text}
                    image={cardImage}
                    ageGate={f.age_gate}
                    breakout={f.breakout}
                    openUrl={link ? `${link}/open` : "#"}
                    preview
                  />
                </FunnelShell>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {shown === 1
              ? "The button's words follow the phone's language; pick one above to see them."
              : "What a fan sees once the page is open in the real browser."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/40 bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{lead}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
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
  label,
  url,
  busy,
  disabled,
  onFile,
  hint,
  empty,
  wide = false,
}: {
  label: string;
  url: string | null;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  hint: string;
  empty: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 first:mt-0">
      <div className={`${wide ? "h-20 w-28" : "h-24 w-24"} overflow-hidden rounded-lg border border-border/40 bg-muted/30`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{empty}</div>
        )}
      </div>
      <div>
        <p className="text-xs font-medium">{label}</p>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" className="mt-1" disabled={busy || disabled} onClick={() => ref.current?.click()}>
          {busy ? "Uploading…" : url ? "Replace" : "Upload"}
        </Button>
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
