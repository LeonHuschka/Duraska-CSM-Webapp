-- Daily stories: every story the morning read sees, one row per story, and
-- how many a day an account should post. A story lives 24 hours, so a read
-- once a day sees each one at least once.
create table if not exists public.account_stories (
  id text primary key,                  -- the platform's own story id
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  taken_at timestamptz not null,
  media_type text,
  seen_at timestamptz not null default now()
);
create index if not exists account_stories_account_taken on public.account_stories (account_id, taken_at);

alter table public.account_stories enable row level security;
drop policy if exists "account_stories_member" on public.account_stories;
create policy "account_stories_member" on public.account_stories
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));

alter table public.accounts
  add column if not exists stories_per_day integer not null default 1;

-- The weekly pattern analysis: where it is posted, and what it said.
alter table public.telegram_config
  add column if not exists pattern_thread_id bigint;

create table if not exists public.pattern_reports (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  week_start date not null,
  analysis jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (account_id, week_start)
);

alter table public.pattern_reports enable row level security;
drop policy if exists "pattern_reports_member" on public.pattern_reports;
create policy "pattern_reports_member" on public.pattern_reports
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
