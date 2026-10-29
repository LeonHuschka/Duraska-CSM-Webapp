-- Analysis: why winners win. Every winner, every clean loser and a few
-- ordinary reels per account are watched once by Gemini and classified
-- against a fixed codebook; one row per reel, kept for good, so a reel is
-- never paid for twice. A run then compares the cohorts and stores what it
-- found, with the briefing written from it.

create table if not exists public.reel_analyses (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  shortcode text not null,
  post_url text,
  posted_at timestamptz,
  request_id uuid references public.content_requests(id) on delete set null,
  cohort text not null check (cohort in ('winner', 'loser', 'control')),
  -- The numbers the cohort was picked on, refreshed on every run.
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  lift numeric,
  -- pending → done | failed; failed rows are tried again up to three times.
  status text not null default 'pending' check (status in ('pending', 'working', 'done', 'failed')),
  attempts integer not null default 0,
  note text,
  features jsonb,
  comment_texts jsonb,
  comment_read jsonb,
  model text,
  usage jsonb,
  codebook_version integer,
  analysed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, shortcode)
);
create index if not exists reel_analyses_persona_status on public.reel_analyses (persona_id, status);

alter table public.reel_analyses enable row level security;
drop policy if exists "reel_analyses_member" on public.reel_analyses;
create policy "reel_analyses_member" on public.reel_analyses
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  note text,
  -- How many reels each cohort had, and what the run cost as far as it knows.
  counts jsonb,
  stats jsonb,
  briefing jsonb,
  model text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists analysis_runs_persona_started on public.analysis_runs (persona_id, started_at desc);

alter table public.analysis_runs enable row level security;
drop policy if exists "analysis_runs_member" on public.analysis_runs;
create policy "analysis_runs_member" on public.analysis_runs
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
