"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { setWebhook, getWebhookInfo, getMe } from "@/lib/telegram";

export async function saveTelegramConfig(data: {
  chat_id: string;
  requests_thread_id: string;
  talk_thread_id: string;
  model_username: string;
  va_username: string;
  manager_username: string;
  posts_per_day: number;
  min_ready_to_post: number;
  min_open_links: number;
  max_unedited: number;
  weekly_reel_target: string;
}) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  const num = (v: string) => {
    const n = Number(v.trim());
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  };
  const str = (v: string) => (v.trim() === "" ? null : v.trim().replace(/^@/, ""));

  // The weekly goal drives what the model is measured against — owners only.
  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", personaId)
    .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();
  if (data.weekly_reel_target.trim() !== "" && membership?.role !== "owner") {
    return { error: "Only the owner can set the weekly goal" };
  }

  const { error } = await supabase.from("telegram_config").upsert(
    {
      persona_id: personaId,
      chat_id: num(data.chat_id),
      requests_thread_id: num(data.requests_thread_id),
      talk_thread_id: num(data.talk_thread_id),
      model_username: str(data.model_username),
      va_username: str(data.va_username),
      manager_username: str(data.manager_username),
      posts_per_day: data.posts_per_day,
      min_ready_to_post: data.min_ready_to_post,
      min_open_links: data.min_open_links,
      max_unedited: data.max_unedited,
      // Empty clears the override and falls back to the derived target.
      weekly_reel_target: num(data.weekly_reel_target),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "persona_id" }
  );

  if (error) return { error: error.message };
  revalidatePath("/settings/telegram");
  return { error: null };
}

/** Point Telegram at this deployment's webhook. */
export async function registerWebhook(baseUrl: string) {
  await requireActivePersonaId();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return { error: "TELEGRAM_WEBHOOK_SECRET is not set" };
  const url = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const res = await setWebhook(url, secret);
  if (!res.ok) {
    // Telegram answers a bad token with a bare "Not Found", which reads like
    // the app is broken rather than the credential being wrong.
    if (/not found/i.test(res.error ?? "")) {
      return {
        error:
          "Telegram rejected the bot token (Not Found). It's invalid — most likely the old token is still in Vercel after revoking it, or it got mangled on paste.",
      };
    }
    return { error: res.error ?? "setWebhook failed" };
  }
  return { error: null, url };
}

/**
 * Ask Telegram who the configured token belongs to. Answers the one
 * question that "Not Found" leaves open — is the token in the environment
 * wrong, or is something else broken — without anyone having to read the
 * secret out of the hosting dashboard.
 */
export async function testBotToken() {
  await requireActivePersonaId();
  const res = await getMe();
  if (!res.ok) {
    if (/not found/i.test(res.error ?? "")) {
      return {
        error:
          "Telegram doesn't recognise this token. The value in TELEGRAM_BOT_TOKEN isn't a valid bot token — re-paste it and redeploy.",
      };
    }
    return { error: res.error ?? "getMe failed" };
  }
  const me = res.result as { username?: string; first_name?: string };
  return { error: null, username: me.username ?? me.first_name ?? "unknown" };
}

export async function webhookStatus() {
  await requireActivePersonaId();
  const res = await getWebhookInfo();
  if (!res.ok) return { error: res.error ?? "failed" };
  return { error: null, info: res.result as Record<string, unknown> };
}
