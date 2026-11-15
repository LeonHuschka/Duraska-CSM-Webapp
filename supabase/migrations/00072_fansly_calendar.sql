-- The Fansly calendar: the times a day posts go up (LA time), a day's own
-- times where they differ, and the hashtags a caption ends with. The app
-- fills the free times with Fansly cuts as drafts, with a caption written
-- from the cut's picture; once approved, a post goes to the VA the day
-- before it is due, so she can set it in Fansly's scheduler.
create table if not exists public.fansly_schedule (
  persona_id uuid primary key references public.personas(id) on delete cascade,
  -- "HH:MM" in LA time; as many as there are posts a day.
  slots text[] not null default array['11:00', '20:00'],
  -- {"2026-11-20": ["10:00", "18:00"]} — a day with times of its own.
  overrides jsonb not null default '{}'::jsonb,
  hashtags text not null default '#brunette #naturalbeauty #girlnextdoor #hotbrunette #squirting #wetpussy #prettyface #ass #booty #tits #boobs #pussy #curves',
  updated_at timestamptz not null default now()
);

alter table public.fansly_schedule enable row level security;
drop policy if exists "fansly_schedule_staff" on public.fansly_schedule;
create policy "fansly_schedule_staff" on public.fansly_schedule
  for all to authenticated
  using (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'))
  with check (public.is_owner() or public.get_persona_role(persona_id) in ('owner', 'manager'));

-- Drafts the app made wait for approval; approved ones wait for their day.
alter table public.fansly_posts drop constraint if exists fansly_posts_status_check;
alter table public.fansly_posts
  add constraint fansly_posts_status_check check (status in ('draft', 'approved', 'sending', 'sent', 'failed'));
alter table public.fansly_posts alter column status set default 'draft';
-- Where the caption came from: 'ai', 'emoji' (the picture was unclear) or 'manual'.
alter table public.fansly_posts add column if not exists caption_source text;
