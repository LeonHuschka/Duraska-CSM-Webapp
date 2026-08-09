-- What counts as unacceptably slow, per pipeline leg.
--
-- The gauges need an upper end, and there is no natural one for "days spent
-- waiting" — it depends entirely on how this operation is meant to run. So
-- the bound is a stored number the manager edits straight on the dashboard,
-- rather than a constant baked into the chart.
alter table public.telegram_config
  add column if not exists slow_inspo_days numeric not null default 14,
  add column if not exists slow_edit_days  numeric not null default 7,
  add column if not exists slow_post_days  numeric not null default 7;
