-- Account analytics harvested from the screenshots VAs post in Telegram.
--
-- A VA drops an Instagram insights screenshot into an account's group; the
-- bot reads the numbers off it with a vision model and stores one row per
-- screenshot. Daily and weekly reports are derived from these rows.

-- Which Telegram chat belongs to which account, so a screenshot can be
-- attributed without anyone typing the handle.
alter table public.accounts
  add column if not exists telegram_chat_id bigint;

create index if not exists idx_accounts_telegram_chat
  on public.accounts(telegram_chat_id) where telegram_chat_id is not null;

create table if not exists public.account_metrics (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,

  -- provenance
  source_chat_id bigint,
  source_message_id bigint,
  image_path text,
  captured_at timestamptz not null default now(),

  -- what the screenshot showed
  handle text,
  platform text,
  metric_kind text not null default 'profile'
    check (metric_kind in ('profile','post','story','reel','unknown')),
  period text,                       -- e.g. "last 7 days", "lifetime"

  followers int,
  follows int,
  posts_count int,
  views int,
  reach int,
  impressions int,
  likes int,
  comments int,
  shares int,
  saves int,
  profile_visits int,

  raw jsonb,                         -- everything the model returned
  confidence numeric,                -- 0..1 self-reported by the model
  needs_review boolean not null default false,

  created_at timestamptz not null default now(),
  unique (source_chat_id, source_message_id)
);

create index if not exists idx_account_metrics_persona_time
  on public.account_metrics(persona_id, captured_at desc);
create index if not exists idx_account_metrics_account_time
  on public.account_metrics(account_id, captured_at desc);

alter table public.account_metrics enable row level security;

drop policy if exists "account_metrics_select" on public.account_metrics;
drop policy if exists "account_metrics_write" on public.account_metrics;
create policy "account_metrics_select" on public.account_metrics
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
create policy "account_metrics_write" on public.account_metrics
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));

-- Where the reports get posted.
alter table public.telegram_config
  add column if not exists reports_thread_id bigint,
  add column if not exists last_daily_report_at timestamptz,
  add column if not exists last_weekly_report_at timestamptz;
