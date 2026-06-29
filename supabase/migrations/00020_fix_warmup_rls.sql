-- Fix warm-up RLS + make the whole warm-up schema idempotently correct.
--
-- The original 00019 policies used raw subqueries against persona_members
-- inside the USING/WITH CHECK expressions. Because persona_members itself
-- has RLS enabled, those nested reads get RLS-filtered and can return
-- nothing — silently blocking every insert into accounts / warmup_slots.
--
-- The rest of the schema (content_requests, etc.) avoids this by routing
-- access checks through SECURITY DEFINER helper functions (is_owner(),
-- is_persona_member()) which bypass RLS. This migration brings warm-up in
-- line with that pattern.
--
-- Safe to run whether or not 00019 was already applied: it create-if-not-
-- exists the tables and drop-if-exists the policies before recreating them.

-- ── Tables (no-op if 00019 already created them) ─────────────────────────
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok','fansly','other')),
  handle text not null,
  display_name text,
  status text not null default 'warmup' check (status in ('warmup','graduated','paused','dead')),
  warmup_started_at timestamptz not null default now(),
  warmup_completed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_accounts_persona on public.accounts(persona_id);
create index if not exists idx_accounts_status on public.accounts(persona_id, status);

create table if not exists public.warmup_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  day_number int not null check (day_number >= 1),
  position int not null default 0,
  asset_kind text not null check (asset_kind in (
    'profile_photo','banner','bio','feed_photo','story','reel'
  )),
  asset_id uuid references public.content_assets(id) on delete set null,
  text_content text,
  notes text,
  status text not null default 'pending' check (status in (
    'pending','ready','posted','skipped'
  )),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_warmup_slots_account on public.warmup_slots(account_id, day_number, position);
create index if not exists idx_warmup_slots_status on public.warmup_slots(account_id, status);

alter table public.content_requests
  add column if not exists is_warmup boolean not null default false;
create index if not exists idx_content_requests_warmup
  on public.content_requests(persona_id, is_warmup)
  where is_warmup = true;

-- ── SECURITY DEFINER helper: can the current user access this account? ────
create or replace function public.can_access_account(p_account_id uuid)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists(
    select 1 from public.accounts a
    where a.id = p_account_id
      and (
        public.is_owner()
        or public.is_persona_member(a.persona_id)
      )
  );
$$;

-- ── accounts policies ────────────────────────────────────────────────────
alter table public.accounts enable row level security;

drop policy if exists "accounts_select" on public.accounts;
drop policy if exists "accounts_insert" on public.accounts;
drop policy if exists "accounts_update" on public.accounts;
drop policy if exists "accounts_delete" on public.accounts;

create policy "accounts_select" on public.accounts
  for select to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));

create policy "accounts_insert" on public.accounts
  for insert to authenticated
  with check (public.is_owner() or public.is_persona_member(persona_id));

create policy "accounts_update" on public.accounts
  for update to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));

create policy "accounts_delete" on public.accounts
  for delete to authenticated
  using (public.is_owner() or public.is_persona_member(persona_id));

-- ── warmup_slots policies (access via parent account) ────────────────────
alter table public.warmup_slots enable row level security;

drop policy if exists "warmup_slots_select" on public.warmup_slots;
drop policy if exists "warmup_slots_insert" on public.warmup_slots;
drop policy if exists "warmup_slots_update" on public.warmup_slots;
drop policy if exists "warmup_slots_delete" on public.warmup_slots;

create policy "warmup_slots_select" on public.warmup_slots
  for select to authenticated
  using (public.can_access_account(account_id));

create policy "warmup_slots_insert" on public.warmup_slots
  for insert to authenticated
  with check (public.can_access_account(account_id));

create policy "warmup_slots_update" on public.warmup_slots
  for update to authenticated
  using (public.can_access_account(account_id));

create policy "warmup_slots_delete" on public.warmup_slots
  for delete to authenticated
  using (public.can_access_account(account_id));
