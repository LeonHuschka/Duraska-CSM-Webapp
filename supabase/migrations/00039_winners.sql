-- Winners: reels that went viral on our own accounts, reported once each
-- into the winners topic so the model shoots a fresh version.
alter table public.telegram_config
  add column if not exists winners_thread_id bigint,
  add column if not exists viral_lift numeric not null default 5,
  add column if not exists viral_min_views int not null default 10000;

create table if not exists public.winners (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  shortcode text not null,
  request_id uuid references public.content_requests(id) on delete set null,
  post_url text,
  title text,
  views bigint not null,
  lift numeric,
  message_id bigint,
  notified_at timestamptz not null default now(),
  unique (persona_id, shortcode)
);

alter table public.winners enable row level security;
create policy "winners_select" on public.winners
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
