-- The SHOOTING topic: every morning the bot posts the day's five inspo
-- links to shoot, each with a button that opens its upload page and one
-- that jumps to the inspo in the requests topic. The message is edited as
-- the links get shot, and what is left carries over to the next day.
alter table public.telegram_config
  add column if not exists shoot_thread_id bigint,
  add column if not exists shoot_list_message_id bigint,
  -- The Berlin day the list is for, "2026-11-04".
  add column if not exists shoot_list_day text,
  -- The links on it, in order.
  add column if not exists shoot_list_links uuid[];
