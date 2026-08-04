import { getActivePersonaId } from "@/lib/persona";
import { createClient } from "@/lib/supabase/server";
import { TelegramSettings } from "@/components/settings/telegram-settings";

export interface TelegramConfigRow {
  chat_id: number | null;
  requests_thread_id: number | null;
  talk_thread_id: number | null;
  model_username: string | null;
  va_username: string | null;
  manager_username: string | null;
  posts_per_day: number;
  min_ready_to_post: number;
  min_open_links: number;
  max_unedited: number;
}

export default async function TelegramSettingsPage() {
  const supabase = await createClient();
  const personaId = await getActivePersonaId();
  if (!personaId) {
    return <p className="text-muted-foreground">Select a persona first.</p>;
  }

  const { data } = await supabase
    .from("telegram_config")
    .select(
      "chat_id, requests_thread_id, talk_thread_id, model_username, va_username, manager_username, posts_per_day, min_ready_to_post, min_open_links, max_unedited"
    )
    .eq("persona_id", personaId)
    .maybeSingle();

  const { count: openLinks } = await supabase
    .from("content_links")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "open");

  return (
    <TelegramSettings
      config={(data as TelegramConfigRow) ?? null}
      openLinks={openLinks ?? 0}
      botConfigured={!!process.env.TELEGRAM_BOT_TOKEN}
    />
  );
}
