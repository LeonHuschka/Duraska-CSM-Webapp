-- The bridge between a login and the accounts it manages.
--
-- The pipeline already knows who runs which posting account: accounts carry
-- manager_username, a Telegram handle typed in on the accounts tab. What it
-- did not know is which *login* that handle belongs to, so the vault could
-- not show a VA only her own accounts — every VA saw every account, and the
-- postings of the whole team.
--
-- One nullable column closes the gap. The owner sets it per member on the
-- persona settings page; the vault matches it against manager_username,
-- case-insensitively and with or without the @.

alter table public.user_profiles
  add column if not exists telegram_username text;
