-- Posting accounts registry + record which account a post went to.
--
-- Reuses the existing `accounts` table as the single account registry.
-- Adds 'x' (Twitter/X) to the allowed platforms. A "mark posted" in the
-- Vault now records the specific account_id on the schedule_slot, and the
-- slot's platform is allowed to be facebook / x as well.

-- 1. Allow 'x' on accounts.platform
alter table public.accounts drop constraint if exists accounts_platform_check;
alter table public.accounts
  add constraint accounts_platform_check
  check (platform in ('facebook','instagram','tiktok','fansly','x','other'));

-- 2. schedule_slots: record the account + allow facebook / x platforms
alter table public.schedule_slots
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table public.schedule_slots drop constraint if exists schedule_slots_platform_check;
alter table public.schedule_slots
  add constraint schedule_slots_platform_check
  check (platform in ('instagram','fansly','tiktok','facebook','x','other'));

create index if not exists idx_schedule_slots_account
  on public.schedule_slots(account_id) where account_id is not null;
