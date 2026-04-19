create table public.content_assets (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references public.content_requests(id) on delete cascade,
  stage text not null default 'raw'
    check (stage in ('raw', 'edited', 'final')),
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  duration_seconds float,
  width int,
  height int,
  thumbnail_path text,
  uploaded_by uuid references public.user_profiles(id),
  uploaded_at timestamptz not null default now(),
  notes text,
  deleted_at timestamptz
);

create index idx_content_assets_request on public.content_assets(request_id);
create index idx_content_assets_stage on public.content_assets(request_id, stage);
create index idx_content_assets_active on public.content_assets(request_id) where deleted_at is null;
