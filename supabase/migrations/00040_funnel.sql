-- The link-in-bio landing page on the persona's own domain.
--
-- Instagram flags bio links to known link-in-bio hosts and to adult sites.
-- A page on a domain of our own carries a picture, a name and one button;
-- the destination is never written into the HTML — it is resolved by a
-- redirect on click, after the visitor has been checked for being a person.
create table if not exists public.funnel_pages (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  domain text not null unique,                 -- sarahprice.link
  slug text not null default 'ig',             -- /ig, so several pages can share a domain
  display_name text not null,
  status_text text not null default 'Available now',
  bio_line text not null default '',
  button_label text not null default 'Click to see more ;)',
  destination_url text,                        -- the real target; never sent to the browser
  cover_path text,                             -- storage path in content-assets
  theme_bg text not null default '#F4B6C6',
  theme_button_bg text not null default '#111827',
  theme_button_text text not null default '#ffffff',
  verified boolean not null default true,
  age_gate boolean not null default false,
  breakout boolean not null default true,      -- pop fans out of the in-app browser
  blocked_countries text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain, slug)
);

-- Every visit and click, so the page can say what it did.
create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  page_id uuid not null references public.funnel_pages(id) on delete cascade,
  kind text not null check (kind in ('view', 'click', 'canary', 'blocked')),
  bot boolean not null default false,
  reason text,                                 -- why a visitor was called a bot or blocked
  country text,
  visitor_hash text,                           -- sha256(ip + ua), never the ip itself
  referrer text,
  in_app boolean not null default false,       -- came through the Instagram/TikTok browser
  platform text,                               -- ios / android / other
  created_at timestamptz not null default now()
);
create index if not exists idx_funnel_events_page_time on public.funnel_events(page_id, created_at desc);
create index if not exists idx_funnel_events_visitor on public.funnel_events(page_id, visitor_hash, kind, created_at desc);

alter table public.funnel_pages enable row level security;
alter table public.funnel_events enable row level security;

create policy "funnel_pages_select" on public.funnel_pages
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));
create policy "funnel_pages_write" on public.funnel_pages
  for all to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id))
  with check (public.is_owner() or public.is_persona_member(persona_id));
create policy "funnel_events_select" on public.funnel_events
  for select to authenticated
  using (exists (
    select 1 from public.funnel_pages p
    where p.id = funnel_events.page_id
      and (public.is_owner() or public.is_persona_member(p.persona_id))
  ));
-- Visitors are anonymous; the public routes write through the service role.
