-- The team's own to-do list on the pipeline dashboard: entries owners and
-- managers write and tick for themselves. Kept in a table of its own so it
-- never mixes with the model's checklist, and the model cannot read it.
create table if not exists public.team_todos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  repeat text not null default 'all' check (repeat in ('all', '1d', '7d', '30d')),
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists team_todos_persona on public.team_todos (persona_id, position);

alter table public.team_todos enable row level security;
drop policy if exists "team_todos_staff" on public.team_todos;
create policy "team_todos_staff" on public.team_todos
  for all to authenticated
  using (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'))
  with check (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'));
