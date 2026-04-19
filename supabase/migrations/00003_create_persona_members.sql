create table public.persona_members (
  persona_id uuid not null references public.personas(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null default 'va'
    check (role in ('owner', 'manager', 'model', 'va')),
  created_at timestamptz not null default now(),
  primary key (persona_id, user_id)
);

create index idx_persona_members_user on public.persona_members(user_id);
create index idx_persona_members_persona on public.persona_members(persona_id);
