-- How often each account actually posts, and who runs it.
--
-- Demand used to be one number on the persona multiplied by the number of
-- live accounts, which said six reels a day when the real answer was three:
-- two on one Facebook account, one on the other, none on Instagram while it
-- warms up. Every figure derived from it — the weekly goal, days of stock,
-- the runway in the Telegram alert — inherited that error.
alter table public.accounts
  add column if not exists posts_per_day numeric not null default 2,
  add column if not exists manager_username text;
