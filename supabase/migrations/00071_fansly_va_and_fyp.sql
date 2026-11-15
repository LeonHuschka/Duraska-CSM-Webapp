-- The Fansly planner tags the VA who runs Fansly, not the Instagram VA,
-- and each planned post says whether it goes on Fansly's FYP.
alter table public.telegram_config add column if not exists fansly_va_username text;
update public.telegram_config set fansly_va_username = 'haroldceranos' where chat_id = -1003893140029;
alter table public.fansly_posts add column if not exists fyp boolean not null default true;
