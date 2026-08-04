-- Manual override for the model's weekly reel goal.
--
-- By default the goal is derived from live accounts × posts/day × 7, which
-- can get unrealistic fast (3 accounts already implies 42/week). When this
-- is set to a positive number it wins over the calculation.
alter table public.telegram_config
  add column if not exists weekly_reel_target int;
