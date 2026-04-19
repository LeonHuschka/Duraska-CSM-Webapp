-- =============================================
-- Helper functions (security definer to bypass RLS)
-- =============================================

create or replace function public.is_owner()
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists(
    select 1 from public.user_profiles
    where id = (select auth.uid())
      and global_role = 'owner'
  );
$$;

create or replace function public.is_persona_member(p_persona_id uuid, p_role text default null)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists(
    select 1 from public.persona_members
    where user_id = (select auth.uid())
      and persona_id = p_persona_id
      and (p_role is null or role = p_role)
  );
$$;

create or replace function public.get_persona_role(p_persona_id uuid)
returns text
language sql
security definer set search_path = ''
stable
as $$
  select role from public.persona_members
  where user_id = (select auth.uid())
    and persona_id = p_persona_id;
$$;

-- =============================================
-- user_profiles
-- =============================================
alter table public.user_profiles enable row level security;

create policy "user_profiles_select" on public.user_profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_owner()
    or exists(
      select 1 from public.persona_members pm1
      join public.persona_members pm2 on pm1.persona_id = pm2.persona_id
      where pm1.user_id = (select auth.uid()) and pm2.user_id = user_profiles.id
    )
  );

create policy "user_profiles_update" on public.user_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Insert blocked: handled by on_auth_user_created trigger (security definer)
create policy "user_profiles_insert" on public.user_profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

-- =============================================
-- personas
-- =============================================
alter table public.personas enable row level security;

create policy "personas_select" on public.personas
  for select to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(id)
  );

create policy "personas_insert" on public.personas
  for insert to authenticated
  with check (public.is_owner());

create policy "personas_update" on public.personas
  for update to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(id, 'owner')
  )
  with check (
    public.is_owner()
    or public.is_persona_member(id, 'owner')
  );

create policy "personas_delete" on public.personas
  for delete to authenticated
  using (public.is_owner());

-- =============================================
-- persona_members
-- =============================================
alter table public.persona_members enable row level security;

create policy "persona_members_select" on public.persona_members
  for select to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "persona_members_insert" on public.persona_members
  for insert to authenticated
  with check (
    public.is_owner()
    or public.is_persona_member(persona_id, 'owner')
  );

create policy "persona_members_update" on public.persona_members
  for update to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id, 'owner')
  );

create policy "persona_members_delete" on public.persona_members
  for delete to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id, 'owner')
  );

-- =============================================
-- content_requests
-- =============================================
alter table public.content_requests enable row level security;

create policy "content_requests_select" on public.content_requests
  for select to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "content_requests_insert" on public.content_requests
  for insert to authenticated
  with check (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "content_requests_update" on public.content_requests
  for update to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "content_requests_delete" on public.content_requests
  for delete to authenticated
  using (
    public.is_owner()
    or (
      public.is_persona_member(persona_id)
      and public.get_persona_role(persona_id) != 'va'
    )
  );

-- =============================================
-- content_assets
-- =============================================
alter table public.content_assets enable row level security;

create policy "content_assets_select" on public.content_assets
  for select to authenticated
  using (
    public.is_owner()
    or exists(
      select 1 from public.content_requests cr
      where cr.id = content_assets.request_id
        and public.is_persona_member(cr.persona_id)
    )
  );

create policy "content_assets_insert" on public.content_assets
  for insert to authenticated
  with check (
    public.is_owner()
    or exists(
      select 1 from public.content_requests cr
      where cr.id = content_assets.request_id
        and public.is_persona_member(cr.persona_id)
    )
  );

create policy "content_assets_update" on public.content_assets
  for update to authenticated
  using (
    public.is_owner()
    or exists(
      select 1 from public.content_requests cr
      where cr.id = content_assets.request_id
        and public.is_persona_member(cr.persona_id)
    )
  );

create policy "content_assets_delete" on public.content_assets
  for delete to authenticated
  using (
    public.is_owner()
    or exists(
      select 1 from public.content_requests cr
      where cr.id = content_assets.request_id
        and public.is_persona_member(cr.persona_id)
        and public.get_persona_role(cr.persona_id) != 'va'
    )
  );

-- =============================================
-- schedule_slots
-- =============================================
alter table public.schedule_slots enable row level security;

create policy "schedule_slots_select" on public.schedule_slots
  for select to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "schedule_slots_insert" on public.schedule_slots
  for insert to authenticated
  with check (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "schedule_slots_update" on public.schedule_slots
  for update to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "schedule_slots_delete" on public.schedule_slots
  for delete to authenticated
  using (
    public.is_owner()
    or (
      public.is_persona_member(persona_id)
      and public.get_persona_role(persona_id) != 'va'
    )
  );

-- =============================================
-- activity_log (append-only: no update or delete)
-- =============================================
alter table public.activity_log enable row level security;

create policy "activity_log_select" on public.activity_log
  for select to authenticated
  using (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

create policy "activity_log_insert" on public.activity_log
  for insert to authenticated
  with check (
    public.is_owner()
    or public.is_persona_member(persona_id)
  );

-- =============================================
-- Storage: content-assets bucket
-- Path convention: personas/{persona_id}/requests/{request_id}/{stage}/{filename}
-- storage.foldername() returns 1-based array of path segments
-- =============================================

create policy "storage_content_assets_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'content-assets'
    and (
      public.is_owner()
      or public.is_persona_member((storage.foldername(name))[2]::uuid)
    )
  );

create policy "storage_content_assets_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'content-assets'
    and (
      public.is_owner()
      or public.is_persona_member((storage.foldername(name))[2]::uuid)
    )
  );

create policy "storage_content_assets_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'content-assets'
    and (
      public.is_owner()
      or public.is_persona_member((storage.foldername(name))[2]::uuid)
    )
  );

create policy "storage_content_assets_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'content-assets'
    and (
      public.is_owner()
      or (
        public.is_persona_member((storage.foldername(name))[2]::uuid)
        and public.get_persona_role((storage.foldername(name))[2]::uuid) != 'va'
      )
    )
  );
