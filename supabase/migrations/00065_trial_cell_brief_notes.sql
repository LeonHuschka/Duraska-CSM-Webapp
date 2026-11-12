-- Per variant of a trial: what the model is to do in it (she sees it),
-- and the team's own notes on it (staff only on the page).
alter table public.trial_cells
  add column if not exists brief text,
  add column if not exists notes text;
