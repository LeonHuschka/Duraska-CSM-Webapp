-- Accounts live in topics of one forum group, not in separate groups.
--
-- Screenshots for every account therefore arrive with the same chat id and
-- differ only by message_thread_id, so a chat-only mapping would attribute
-- all of them to whichever account was matched first. Keep the chat id for
-- accounts that do get their own group, and add the topic alongside it.
alter table public.accounts
  add column if not exists telegram_thread_id bigint;

create index if not exists idx_accounts_telegram_topic
  on public.accounts(telegram_chat_id, telegram_thread_id)
  where telegram_chat_id is not null;
