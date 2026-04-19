-- Forward-only status advancement when assets are uploaded
create or replace function public.auto_advance_request_on_asset()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.stage = 'raw' then
    update public.content_requests
    set status = 'shooted'
    where id = new.request_id and status = 'requested';
  elsif new.stage = 'edited' then
    update public.content_requests
    set status = 'edited'
    where id = new.request_id and status in ('requested', 'shooted');
  end if;
  return new;
end;
$$;

create trigger on_asset_insert
  after insert on public.content_assets
  for each row execute procedure public.auto_advance_request_on_asset();

-- Advance to "scheduled" when a schedule slot is created
create or replace function public.auto_advance_request_on_schedule()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.request_id is not null then
    update public.content_requests
    set status = 'scheduled'
    where id = new.request_id
      and status in ('requested', 'shooted', 'edited');
  end if;
  return new;
end;
$$;

create trigger on_schedule_slot_insert
  after insert on public.schedule_slots
  for each row execute procedure public.auto_advance_request_on_schedule();

-- Advance to "posted" when all schedule slots for a request are posted
create or replace function public.auto_advance_request_on_post()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status = 'posted' and (old.status is distinct from 'posted') and new.request_id is not null then
    if not exists(
      select 1 from public.schedule_slots
      where request_id = new.request_id
        and status != 'posted'
        and id != new.id
    ) then
      update public.content_requests
      set status = 'posted'
      where id = new.request_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger on_schedule_slot_update
  after update on public.schedule_slots
  for each row execute procedure public.auto_advance_request_on_post();
