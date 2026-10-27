-- Fansly takes: every reel is shot once more in a Fansly outfit. The model
-- marks those takes on upload; their finished cuts are stage 'fansly', so
-- nothing that reads Instagram cuts (matching, vault "ready", trials)
-- ever picks one up.
alter table public.content_assets add column if not exists fansly boolean not null default false;
alter table public.content_assets drop constraint if exists content_assets_stage_check;
alter table public.content_assets add constraint content_assets_stage_check
  check (stage in ('raw', 'edited', 'final', 'fansly'));

-- Trial-Maxxing: one reel goes in once, an account runs one trial at a
-- time. A bigger winner on a busy account is proposed, not started — the
-- team decides in Telegram whether it replaces the running one.
--   proposed   waiting for that decision
--   replaced   was running, a bigger winner took its place
--   dismissed  never ran: a duplicate of a reel already in, or turned down
alter table public.trials drop constraint if exists trials_status_check;
alter table public.trials add constraint trials_status_check
  check (status in ('active', 'done', 'archived', 'proposed', 'replaced', 'dismissed'));
alter table public.trials add column if not exists replaces_trial_id uuid references public.trials(id) on delete set null;
alter table public.trials add column if not exists status_note text;

-- The tongue reel went in twice: on @sarahpricexo and on @sarahelenaprice.
-- The bigger one stays.
update public.trials
  set status = 'dismissed', status_note = 'Same reel as the trial on sarahelenaprice (Dem2Xc2uiAT)'
  where shortcode = 'DevlZIihtLs' and status = 'active';
