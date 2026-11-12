-- A word or two the team gives a trial so the model knows which reel it is
-- (SHOOTING shows it in place of the account's handle).
alter table public.trials add column if not exists nickname text;
