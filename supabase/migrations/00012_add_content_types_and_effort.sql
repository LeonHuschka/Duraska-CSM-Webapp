-- Content types per persona (e.g. Ballerina, Speaking, Posing, Roleplay)
create table public.content_types (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_content_types_persona on public.content_types(persona_id);

-- Add content_type_id to content_requests
alter table public.content_requests
  add column content_type_id uuid references public.content_types(id);

-- Add inspo_link (single text field, simpler than the existing inspo_links array)
alter table public.content_requests
  add column inspo_link text;

-- Migrate priority values to effort values
update public.content_requests set priority = 'medium' where priority = 'normal';
update public.content_requests set priority = 'easy' where priority = 'low';

-- Drop old check constraint and add new one with effort values
alter table public.content_requests
  drop constraint content_requests_priority_check;

alter table public.content_requests
  add constraint content_requests_priority_check
  check (priority in ('easy', 'medium', 'high', 'heavy'));

-- Update default
alter table public.content_requests
  alter column priority set default 'medium';

-- RLS for content_types
alter table public.content_types enable row level security;

create policy "content_types_select" on public.content_types
  for select using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = content_types.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "content_types_insert" on public.content_types
  for insert with check (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = content_types.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "content_types_update" on public.content_types
  for update using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = content_types.persona_id
        and persona_members.user_id = auth.uid()
    )
  );

create policy "content_types_delete" on public.content_types
  for delete using (
    exists (
      select 1 from public.persona_members
      where persona_members.persona_id = content_types.persona_id
        and persona_members.user_id = auth.uid()
        and persona_members.role in ('owner', 'manager')
    )
  );
