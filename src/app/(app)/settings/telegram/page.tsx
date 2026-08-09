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
  weekly_reel_target: number | null;
  screenshot_senders: string[] | null;
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
      "chat_id, requests_thread_id, talk_thread_id, model_username, va_username, manager_username, posts_per_day, min_ready_to_post, min_open_links, max_unedited, weekly_reel_target, screenshot_senders"
    )
    .eq("persona_id", personaId)
    .maybeSingle();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("persona_members")
    .select("role")
    .eq("persona_id", personaId)
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  const isOwner = membership?.role === "owner";

  const { count: openLinks } = await supabase
    .from("content_links")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "open");

  // Links nobody has touched in a fortnight are usually dead or forgotten.
  // Nothing else surfaces them, so they quietly inflate the backlog and the
  // model's "to shoot" number along with it.
  const staleBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const { count: staleLinks } = await supabase
    .from("content_links")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "open")
    .lt("posted_at", staleBefore.toISOString());

  return (
    <TelegramSettings
      config={(data as TelegramConfigRow) ?? null}
      openLinks={openLinks ?? 0}
      staleLinks={staleLinks ?? 0}
      botConfigured={!!process.env.TELEGRAM_BOT_TOKEN}
      isOwner={isOwner}
    />
  );
}
