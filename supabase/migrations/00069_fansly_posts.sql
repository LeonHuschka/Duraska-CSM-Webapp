-- The Fansly planner: a Fansly cut from the vault, planned for a time with
-- its caption, goes straight to the VA's Fansly topic in Telegram as a task
-- ("schedule for X"); the VA sets it in Fansly's own scheduler. The table
-- keeps what was planned, so the vault can show it.
alter table public.telegram_config add column if not exists fansly_thread_id integer;
update public.telegram_config set fansly_thread_id = 3608 where chat_id = -1003893140029;

create table if not exists public.fansly_posts (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  asset_id uuid not null references public.content_assets(id) on delete cascade,
  scheduled_for timestamptz not null,
  caption text not null default '',
  -- PPV price in dollars; null is a free post.
  price numeric(8, 2),
  note text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  message_id bigint,
  error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists fansly_posts_persona on public.fansly_posts (persona_id, scheduled_for);

alter table public.fansly_posts enable row level security;
drop policy if exists "fansly_posts_staff" on public.fansly_posts;
create policy "fansly_posts_staff" on public.fansly_posts
  for all to authenticated
  using (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'))
  with check (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'));
