"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActivePersonaId } from "@/lib/persona";
import { setWebhook, getWebhookInfo } from "@/lib/telegram";

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
}) {
  const supabase = await createClient();
  const personaId = await requireActivePersonaId();

  const num = (v: string) => {
    const n = Number(v.trim());
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  };
  const str = (v: string) => (v.trim() === "" ? null : v.trim().replace(/^@/, ""));

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
  if (!res.ok) return { error: res.error ?? "setWebhook failed" };
  return { error: null, url };
}

export async function webhookStatus() {
  await requireActivePersonaId();
  const res = await getWebhookInfo();
  if (!res.ok) return { error: res.error ?? "failed" };
  return { error: null, info: res.result as Record<string, unknown> };
}
