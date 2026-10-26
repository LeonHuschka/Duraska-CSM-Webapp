-- Page 2's Telegram button: "dm me a 🤫".
alter table public.funnel_pages alter column telegram_label set default 'dm me a 🤫';
update public.funnel_pages set telegram_label = 'dm me a 🤫' where telegram_label = 'chat with mee..';
