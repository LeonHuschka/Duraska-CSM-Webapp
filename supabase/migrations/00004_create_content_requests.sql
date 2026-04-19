create table public.content_requests (
  id uuid primary key default uuid_generate_v4(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  title text not null,
  description text,
  inspo_links text[] default '{}',
  reference_image_urls text[] default '{}',
  status text not null default 'requested'
    check (status in ('requested', 'shooted', 'edited', 'scheduled', 'posted', 'archived')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  due_date date,
  created_by uuid references public.user_profiles(id),
  assigned_to uuid references public.user_profiles(id),
  position float not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger content_requests_updated_at
  before update on public.content_requests
  for each row execute procedure public.set_updated_at();

create index idx_content_requests_persona on public.content_requests(persona_id);
create index idx_content_requests_status on public.content_requests(persona_id, status);
create index idx_content_requests_assigned on public.content_requests(assigned_to);
