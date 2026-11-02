-- Auto-posting: an Instagram account connected through Instagram's own API
-- publishes the reels scheduled for it in the planner by itself.

-- The connection. The token never reaches a browser: RLS is on with no
-- policies, so only the service key reads or writes it.
create table if not exists public.ig_connections (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  ig_user_id text not null,
  username text,
  access_token text not null,
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz
);
alter table public.ig_connections enable row level security;

-- A planned post that goes out by itself, and where it is on the way.
--   publish_state: null/queued → uploading → publishing → published, or failed
alter table public.schedule_slots
  add column if not exists auto_publish boolean not null default false,
  add column if not exists trial_reel boolean not null default false,
  add column if not exists share_to_feed boolean not null default true,
  add column if not exists publish_state text,
  add column if not exists publish_error text,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists ig_container_id text,
  add column if not exists ig_media_id text,
  add column if not exists publish_started_at timestamptz;

create index if not exists idx_schedule_slots_auto_due
  on public.schedule_slots(scheduled_for)
  where auto_publish and status = 'scheduled';

-- A secret only the database and the app know, for the timer's calls.
-- Made here, so it is never typed or shown anywhere.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (name, value)
  values ('publish_cron', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (name) do nothing;

-- The timer: every five minutes, publish whatever is due.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'auto-publish',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://csm-duraskastudios.space/api/cron/publish',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-publish-secret', (select value from public.app_secrets where name = 'publish_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
  $$
);
