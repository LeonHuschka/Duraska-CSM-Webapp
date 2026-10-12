-- Countries left out of the link statistics: where the team tests from.
alter table public.funnel_pages
  add column if not exists ignored_countries text[] not null default '{}';
