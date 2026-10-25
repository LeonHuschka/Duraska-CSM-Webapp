-- Telegram on the link pages: the icon beside Instagram on both pages, and
-- a second button under the card on page 2.
alter table public.funnel_pages
  add column if not exists telegram_url text,
  add column if not exists telegram_label text not null default 'or get naughty wm here..';
