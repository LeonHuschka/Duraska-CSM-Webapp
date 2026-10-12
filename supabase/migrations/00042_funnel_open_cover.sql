-- Page 2 gets its own header picture; page 1 keeps the cover Instagram sees.
alter table public.funnel_pages
  add column if not exists open_cover_path text;
