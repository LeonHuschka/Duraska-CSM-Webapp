-- Account warmup system.
--
-- An "account" is a single FB/IG/etc handle being warmed up for a persona.
-- Multiple accounts per platform per persona are allowed (typical workflow:
-- run several FB accounts through warmup in parallel).
--
-- A "warmup_slot" is a single planned content unit on a specific day of the
-- account's warmup schedule (e.g. "Day 4: feed photo #1", "Day 6: reel #1").
-- Slots are pre-generated when an account is created, based on the warmup
-- spec hardcoded in src/lib/warmup-spec.ts. The model fills slots by
-- attaching a content_asset from the warmup pool and then marks them posted.
--
-- "is_warmup" on content_requests tags a request as belonging to the
-- warmup content pool — uploaded specifically for warming accounts.
-- Requests without this flag are normal / "great pond" content.

create table public.accounts (
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

create index idx_accounts_persona on public.accounts(persona_id);
create index idx_accounts_status on public.accounts(persona_id, status);

create table public.warmup_slots (
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

create index idx_warmup_slots_account on public.warmup_slots(account_id, day_number, position);
create index idx_warmup_slots_status on public.warmup_slots(account_id, status);

-- Flag content_requests as belonging to the warmup pool.
alter table public.content_requests
  add column if not exists is_warmup boolean not null default false;

create index if not exists idx_content_requests_warmup
  on public.content_requests(persona_id, is_warmup)
  where is_warmup = true;

-- RLS policies — same model as other persona-scoped tables: anyone with
-- access to the persona via persona_members can read/write its accounts +
-- warmup_slots.
alter table public.accounts enable row level security;
alter table public.warmup_slots enable row level security;

create policy "accounts_select" on public.accounts
  for select using (
    persona_id in (
      select persona_id from public.persona_members where user_id = auth.uid()
    )
  );

create policy "accounts_insert" on public.accounts
  for insert with check (
    persona_id in (
      select persona_id from public.persona_members where user_id = auth.uid()
    )
  );

create policy "accounts_update" on public.accounts
  for update using (
    persona_id in (
      select persona_id from public.persona_members where user_id = auth.uid()
    )
  );

create policy "accounts_delete" on public.accounts
  for delete using (
    persona_id in (
      select persona_id from public.persona_members where user_id = auth.uid()
    )
  );

create policy "warmup_slots_select" on public.warmup_slots
  for select using (
    account_id in (
      select id from public.accounts where persona_id in (
        select persona_id from public.persona_members where user_id = auth.uid()
      )
    )
  );

create policy "warmup_slots_insert" on public.warmup_slots
  for insert with check (
    account_id in (
      select id from public.accounts where persona_id in (
        select persona_id from public.persona_members where user_id = auth.uid()
      )
    )
  );

create policy "warmup_slots_update" on public.warmup_slots
  for update using (
    account_id in (
      select id from public.accounts where persona_id in (
        select persona_id from public.persona_members where user_id = auth.uid()
      )
    )
  );

create policy "warmup_slots_delete" on public.warmup_slots
  for delete using (
    account_id in (
      select id from public.accounts where persona_id in (
        select persona_id from public.persona_members where user_id = auth.uid()
      )
    )
  );
