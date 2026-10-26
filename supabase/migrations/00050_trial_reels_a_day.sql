-- How many trial reels an account should post a day, beside its regular
-- reels: the posting calendar on the accounts tab colours each day by both.
alter table public.accounts
  add column if not exists trial_reels_per_day integer not null default 0;

-- Page 2's Telegram button speaks for itself now.
alter table public.funnel_pages alter column telegram_label set default 'chat with mee..';
update public.funnel_pages set telegram_label = 'chat with mee..' where telegram_label = 'or get naughty wm here..';
