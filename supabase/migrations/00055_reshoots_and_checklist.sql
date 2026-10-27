-- Trial-Maxxing: how many reshoots a round has is set per trial (it was
-- always six), and a persona's last choice is what new trials start with.
alter table public.trial_cells drop constraint if exists trial_cells_slot_check;
alter table public.trial_cells add constraint trial_cells_slot_check check (slot between 1 and 12);
alter table public.trials add column if not exists reshoots smallint not null default 6;
alter table public.personas add column if not exists trial_reshoots smallint not null default 6;

-- The model's checklist: entries the managers write, boxes she ticks.
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists checklist_items_persona on public.checklist_items (persona_id, position);

alter table public.checklist_items enable row level security;
drop policy if exists "checklist_items_member" on public.checklist_items;
create policy "checklist_items_member" on public.checklist_items
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
