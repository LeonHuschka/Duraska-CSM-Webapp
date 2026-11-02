-- Feed posts in the planner: a single picture or a carousel of up to ten,
-- uploaded in the planner rather than taken from the vault.
--   media_kind: reel (asset_id is the cut) | image | carousel (media_paths)
alter table public.schedule_slots
  add column if not exists media_kind text not null default 'reel',
  add column if not exists media_paths text[];

do $$ begin
  alter table public.schedule_slots
    add constraint schedule_slots_media_kind_check check (media_kind in ('reel', 'image', 'carousel'));
exception when duplicate_object then null;
end $$;

-- The time zone an account posts for (its audience's), e.g. America/New_York.
-- The planner shows and plans its times in it; null is Berlin.
alter table public.accounts
  add column if not exists post_timezone text;
