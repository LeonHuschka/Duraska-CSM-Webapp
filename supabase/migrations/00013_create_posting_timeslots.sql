-- Predefined posting timeslots per persona (template times, not date-specific)
create table public.posting_timeslots (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  time_utc time not null,
  label text,
  platform text default 'fansly',
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_posting_timeslots_persona on public.posting_timeslots(persona_id);

-- RLS
alter table public.posting_timeslots enable row level security;

create policy "posting_timeslots_select" on public.posting_timeslots
  for select using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = posting_timeslots.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "posting_timeslots_insert" on public.posting_timeslots
  for insert with check (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = posting_timeslots.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "posting_timeslots_update" on public.posting_timeslots
  for update using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = posting_timeslots.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "posting_timeslots_delete" on public.posting_timeslots
  for delete using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = posting_timeslots.persona_id
        and persona_members.user_id = auth.uid()
    )
  );
