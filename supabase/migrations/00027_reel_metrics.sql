-- Per-reel numbers, read off the grid screenshot.
--
-- The VAs send two images per account: the profile, and the grid of recent
-- reels with a view count on each tile. account_metrics holds one row per
-- screenshot and can only carry the profile numbers; a grid is a list, so
-- it gets its own table with one row per tile.
--
-- Tiles are identified by their position, 1 = newest. Which of our reels a
-- tile shows is resolved separately, against the order in which reels were
-- marked posted on that account.
create table if not exists public.reel_metrics (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,

  captured_at timestamptz not null default now(),
  position int not null,
  views bigint,
  likes bigint,
  caption text,

  -- provenance, and the key that makes redelivery harmless
  source_chat_id bigint,
  source_message_id bigint,

  confidence numeric,
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_reel_metrics_source
  on public.reel_metrics(source_chat_id, source_message_id, position)
  where source_chat_id is not null;

create index if not exists idx_reel_metrics_account_time
  on public.reel_metrics(account_id, captured_at desc);

alter table public.reel_metrics enable row level security;

drop policy if exists "reel_metrics_select" on public.reel_metrics;
drop policy if exists "reel_metrics_write" on public.reel_metrics;
create policy "reel_metrics_select" on public.reel_metrics
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
create policy "reel_metrics_write" on public.reel_metrics
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
