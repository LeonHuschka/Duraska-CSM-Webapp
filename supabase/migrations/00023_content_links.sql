-- Telegram-sourced inspo links + their lifecycle.
--
-- Flow: a manager drops an Instagram reel link in the "content requests"
-- topic. The model reacts to that message once she has re-shot it. She then
-- uploads the takes in the webapp pasting the same link as inspo, which is
-- how a link gets matched to a content_request. The bot reacts on the
-- original Telegram message at each step so the group sees progress.
--
--   open     link posted, nothing done yet
--   shot     model reacted in Telegram = she filmed it
--   uploaded matched to a content_request (takes are in the app)
--   edited   that request has final cuts
--   dead     the Instagram post is gone
--   skipped  manually dismissed

create table if not exists public.content_links (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,

  -- Telegram origin
  chat_id bigint not null,
  message_thread_id bigint,
  message_id bigint not null,
  sender_name text,

  url text not null,
  url_key text not null,           -- normalised URL used for matching
  posted_at timestamptz not null,

  status text not null default 'open'
    check (status in ('open','shot','uploaded','edited','dead','skipped')),
  shot_at timestamptz,
  request_id uuid references public.content_requests(id) on delete set null,

  -- availability check
  link_ok boolean,
  checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (chat_id, message_id)
);

create index if not exists idx_content_links_persona_status
  on public.content_links(persona_id, status);
create index if not exists idx_content_links_url_key
  on public.content_links(persona_id, url_key);

-- Per-persona Telegram wiring + content targets. One row per persona.
create table if not exists public.telegram_config (
  persona_id uuid primary key references public.personas(id) on delete cascade,
  chat_id bigint,                       -- the CRM supergroup
  requests_thread_id bigint,            -- "content requests" topic
  talk_thread_id bigint,                -- "TALK / INSTRUCTIONS" topic
  model_username text,                  -- for @mentions
  va_username text,
  manager_username text,
  posts_per_day int not null default 2,
  min_ready_to_post int not null default 6,
  min_open_links int not null default 10,
  max_unedited int not null default 15,
  last_alert_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_links enable row level security;
alter table public.telegram_config enable row level security;

drop policy if exists "content_links_select" on public.content_links;
drop policy if exists "content_links_write" on public.content_links;
create policy "content_links_select" on public.content_links
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
create policy "content_links_write" on public.content_links
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));

drop policy if exists "telegram_config_select" on public.telegram_config;
drop policy if exists "telegram_config_write" on public.telegram_config;
create policy "telegram_config_select" on public.telegram_config
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
create policy "telegram_config_write" on public.telegram_config
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
