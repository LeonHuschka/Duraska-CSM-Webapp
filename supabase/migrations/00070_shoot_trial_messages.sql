-- SHOOTING: every running trial gets a message of its own under the
-- morning's list. Which message belongs to which trial, so the bot can
-- update them as boxes are shot and clear them the next morning.
alter table public.telegram_config
  add column if not exists shoot_trial_messages jsonb not null default '{}'::jsonb;
