create table public.activity_log (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  request_id uuid references public.content_requests(id) on delete set null,
  user_id uuid not null references public.user_profiles(id),
  action text not null,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_log_persona on public.activity_log(persona_id);
create index idx_activity_log_request on public.activity_log(request_id);
create index idx_activity_log_created on public.activity_log(created_at desc);
