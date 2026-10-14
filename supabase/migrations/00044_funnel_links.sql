-- Siblings: one address per account on the same page. The page's own slug
-- stays the first link; these are the others. Events remember which link
-- they came through, so a flag on one shows up as that one going quiet.
create table if not exists public.funnel_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.funnel_pages(id) on delete cascade,
  slug text not null,
  label text not null default '',            -- whose link this is: "Harold · @handle"
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (page_id, slug)
);
alter table public.funnel_links enable row level security;
create policy "funnel_links_all" on public.funnel_links
  for all to authenticated
  using (exists (select 1 from public.funnel_pages p where p.id = funnel_links.page_id
                 and (public.is_owner() or public.is_persona_member(p.persona_id))))
  with check (exists (select 1 from public.funnel_pages p where p.id = funnel_links.page_id
                 and (public.is_owner() or public.is_persona_member(p.persona_id))));

alter table public.funnel_events add column if not exists slug text;
create index if not exists funnel_events_page_slug_idx on public.funnel_events (page_id, slug, created_at desc);
