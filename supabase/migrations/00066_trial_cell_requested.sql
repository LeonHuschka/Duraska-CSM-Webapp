-- When the team sent this variation to the model's SHOOTING message, with
-- its brief and an upload button. Null: not asked for there.
alter table public.trial_cells add column if not exists requested_at timestamptz;
