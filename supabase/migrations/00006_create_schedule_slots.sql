create table public.schedule_slots (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.content_requests(id) on delete set null,
  asset_id uuid references public.content_assets(id) on delete set null,
  persona_id uuid not null references public.personas(id) on delete cascade,
  platform text not null default 'other'
    check (platform in ('instagram', 'fansly', 'tiktok', 'other')),
  caption text,
  scheduled_for timestamptz not null,
  status text not null default 'planned'
    check (status in ('planned', 'ready', 'posted', 'failed')),
  posted_at timestamptz,
  post_url text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create index idx_schedule_slots_persona on public.schedule_slots(persona_id);
create index idx_schedule_slots_scheduled on public.schedule_slots(persona_id, scheduled_for);
