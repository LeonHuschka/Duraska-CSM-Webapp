-- Automatic removal of inspo links whose posts are gone.
--
-- Three things were missing for this to be safe.
--
-- 1. A message can carry more than one link, and only the first was ever
--    stored: the upsert conflicted on (chat_id, message_id) and dropped the
--    rest. Harmless while we only reacted to messages, dangerous the moment
--    we delete them — the first link dies, the message goes, and a second
--    live link nobody ever recorded goes with it. The key now includes the
--    post, so every link in a message is its own row.
--
-- 2. One bad answer must not be enough to delete anything. Instagram hands
--    out "not found" for a post that is deleted, private, suspended or
--    age-restricted alike, and a scraper adds its own bad days on top. A
--    link now has to come back unreachable on several runs, over days,
--    before it is touched.
--
-- 3. Nothing recorded when the check last ran, which is what lets an
--    incoming Telegram update stand in for a scheduled job.

alter table public.content_links
  -- When the link first failed to resolve, cleared the moment it comes back.
  add column if not exists unreachable_since timestamptz,
  -- How many separate runs have failed since then.
  add column if not exists unreachable_runs int not null default 0;

alter table public.telegram_config
  add column if not exists last_link_check_at timestamptz;

-- One row per link, not per message.
alter table public.content_links
  drop constraint if exists content_links_chat_id_message_id_key;
create unique index if not exists content_links_chat_message_url_key
  on public.content_links(chat_id, message_id, url_key);

-- The check reads open links oldest-first; without this it is a sort over
-- the whole table every run.
create index if not exists idx_content_links_due
  on public.content_links(persona_id, status, checked_at nulls first);
