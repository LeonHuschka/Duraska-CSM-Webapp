-- The Telegram button over the card on page 2 can be switched off on its
-- own; the Telegram shortcut in the head stays as long as there is a link.
alter table public.funnel_pages
  add column if not exists telegram_button boolean not null default true;
