-- Trial-Maxxing: an outlier reel is reshot in rounds — six outfits, then
-- six locations in the winning outfit, then six hooks — and each round's
-- winners carry into the next. One trial per outlier, eighteen cells, each
-- cell its own edit job once its takes are in.
create table if not exists public.trials (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  -- The outlier, as it was when the trial started.
  shortcode text not null,
  post_url text,
  caption text,
  cover_path text,
  views integer,
  lift numeric,
  source_request_id uuid references public.content_requests(id) on delete set null,
  phase text not null default 'outfit' check (phase in ('outfit','location','hook','done')),
  status text not null default 'active' check (status in ('active','done','archived')),
  message_id bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, shortcode)
);

create table if not exists public.trial_cells (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references public.trials(id) on delete cascade,
  dimension text not null check (dimension in ('outfit','location','hook')),
  slot smallint not null check (slot between 1 and 6),
  label text,
  request_id uuid references public.content_requests(id) on delete set null,
  thumb_path text,
  finished_at timestamptz,
  winner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trial_id, dimension, slot)
);
create index if not exists trial_cells_request_idx on public.trial_cells(request_id);

alter table public.trials enable row level security;
alter table public.trial_cells enable row level security;

drop policy if exists "trials_member" on public.trials;
create policy "trials_member" on public.trials
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));

drop policy if exists "trial_cells_member" on public.trial_cells;
create policy "trial_cells_member" on public.trial_cells
  for all to authenticated
  using (exists (select 1 from public.trials t where t.id = trial_cells.trial_id
                 and (public.is_owner() or public.is_persona_member(t.persona_id))))
  with check (exists (select 1 from public.trials t where t.id = trial_cells.trial_id
                 and (public.is_owner() or public.is_persona_member(t.persona_id))));
