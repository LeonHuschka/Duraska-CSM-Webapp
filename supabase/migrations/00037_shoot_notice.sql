-- The "new content shot" notice in TALK: one message per shooting session,
-- edited as more takes land, a new one only after an hour of quiet.
alter table public.telegram_config
  add column if not exists shoot_notice_message_id bigint,
  add column if not exists shoot_notice_started_at timestamptz,
  add column if not exists shoot_notice_last_at timestamptz;
