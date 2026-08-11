-- A tile the matcher cannot settle is written anyway, with its best
-- candidate and a flag, because a blank is not more honest than a proposal
-- when the proposal keeps turning out right. Two tiles measured today had
-- the correct cut in first place and were discarded for missing a threshold
-- by a hair.
--
-- The crop is kept so a person can see what was compared without digging
-- the screenshot back out of Telegram.
alter table public.reel_metrics
  add column if not exists match_confirmed boolean not null default false,
  add column if not exists tile_path text;
