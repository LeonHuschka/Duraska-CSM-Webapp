"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";

async function requireStaff(supabase: Awaited<ReturnType<typeof createClient>>, personaId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" as const };
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle(),
    supabase.from("persona_members").select("role").eq("persona_id", personaId).eq("user_id", user.id).maybeSingle(),
  ]);
  const ok = profile?.global_role === "owner" || membership?.role === "owner" || membership?.role === "manager";
  return ok ? { userId: user.id } : { error: "Only owners and managers can do that" as const };
}

export type FunnelForm = {
  domain: string;
  slug: string;
  display_name: string;
  status_text: string;
  bio_line: string;
  button_label: string;
  destination_url: string;
  theme_bg: string;
  theme_button_bg: string;
  theme_button_text: string;
  verified: boolean;
  age_gate: boolean;
  breakout: boolean;
  blocked_countries: string;
  ignored_countries: string;
  enabled: boolean;
  handle: string;
  instagram_url: string;
  show_followers: boolean;
  telegram_url: string;
  telegram_label: string;
};

export async function saveFunnelPage(id: string | null, f: FunnelForm) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error, id: null };

  const domain = f.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!domain) return { error: "A domain is required", id: null };
  const slug = f.slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase() || "ig";
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return { error: "The path may only contain letters, digits and dashes", id: null };
  const destination = f.destination_url.trim();
  if (destination && !/^https:\/\/\S+$/i.test(destination)) return { error: "The destination must be an https:// link", id: null };
  const color = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : fallback);
  const instagram = f.instagram_url.trim();
  const tgRaw = f.telegram_url.trim().replace(/^@/, "");
  const telegram = !tgRaw ? "" : /^https?:\/\//i.test(tgRaw) ? tgRaw.replace(/^http:/i, "https:") : `https://t.me/${tgRaw}`;
  if (telegram && !/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/i.test(telegram)) {
    return { error: "The Telegram link must be a t.me address or a username", id: null };
  }
  if (instagram && !/^https:\/\/(www\.)?instagram\.com\/\S+$/i.test(instagram)) {
    return { error: "The Instagram link must be an https://instagram.com/… address", id: null };
  }

  const row = {
    persona_id: personaId,
    domain,
    slug,
    display_name: f.display_name.trim() || domain,
    status_text: f.status_text.trim(),
    bio_line: f.bio_line.trim(),
    button_label: f.button_label.trim() || "Click to see more ;)",
    destination_url: destination || null,
    theme_bg: color(f.theme_bg, "#F4B6C6"),
    theme_button_bg: color(f.theme_button_bg, "#111827"),
    theme_button_text: color(f.theme_button_text, "#ffffff"),
    verified: f.verified,
    age_gate: f.age_gate,
    breakout: f.breakout,
    blocked_countries: codes(f.blocked_countries),
    ignored_countries: codes(f.ignored_countries),
    enabled: f.enabled,
    handle: f.handle.trim().replace(/^@/, "") || null,
    instagram_url: instagram || null,
    telegram_url: telegram || null,
    telegram_label: f.telegram_label.trim().slice(0, 60) || "or get naughty wm here..",
    show_followers: f.show_followers,
    updated_at: new Date().toISOString(),
  };

  const q = id
    ? supabase.from("funnel_pages").update(row).eq("id", id).eq("persona_id", personaId).select("id").single()
    : supabase.from("funnel_pages").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { error: error.message, id: null };
  revalidatePath("/link/editor");
  revalidatePath("/");
  return { error: null, id: data.id };
}

export type PictureSlot = "cover" | "open_cover" | "button";

const codes = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));

export async function setFunnelCover(id: string, path: string | null, slot: PictureSlot = "cover") {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  if (path && !path.startsWith(`personas/${personaId}/funnel/`)) return { error: "Bad path" };
  const { error } = await supabase
    .from("funnel_pages")
    .update({
      ...(slot === "cover" ? { cover_path: path } : slot === "button" ? { button_image_path: path } : { open_cover_path: path }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("persona_id", personaId);
  if (error) return { error: error.message };
  revalidatePath("/link/editor");
  return { error: null };
}

/** A sibling address for one account; the page is the same. */
export async function addFunnelLink(pageId: string, slug: string, label: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  const s = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(s)) return { error: "The path may only contain letters, digits and dashes" };
  if (["open", "api", "funnel", "_"].includes(s)) return { error: "That path is taken by the site itself" };
  const { data: page } = await supabase.from("funnel_pages").select("slug").eq("id", pageId).eq("persona_id", personaId).maybeSingle();
  if (!page) return { error: "No such page" };
  if (page.slug === s) return { error: "That is the page's own path already" };
  const { error } = await supabase.from("funnel_links").insert({ page_id: pageId, slug: s, label: label.trim().slice(0, 80) });
  if (error) return { error: error.code === "23505" ? "That path exists already" : error.message };
  revalidatePath("/link/editor");
  revalidatePath("/");
  return { error: null };
}

export async function removeFunnelLink(id: string) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();
  const who = await requireStaff(supabase, personaId);
  if ("error" in who) return { error: who.error };
  const { error } = await supabase.from("funnel_links").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/link/editor");
  revalidatePath("/");
  return { error: null };
}
