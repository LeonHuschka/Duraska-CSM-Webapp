create table public.personas (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  avatar_url text,
  brand_color text not null default '#6366f1',
  platforms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger personas_updated_at
  before update on public.personas
  for each row execute procedure public.set_updated_at();

create index idx_personas_slug on public.personas(slug);
