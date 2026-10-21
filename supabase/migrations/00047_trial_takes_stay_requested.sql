-- A Trial-Maxxing cell collects takes over days and goes to editing when
-- the model presses finish. The first raw take must not move its job to
-- "shooted" on its own, or it lands in editing with one take of six.
create or replace function public.auto_advance_request_on_asset()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.stage = 'raw' then
    update public.content_requests r
    set status = 'shooted'
    where r.id = new.request_id and r.status = 'requested'
      and not exists (
        select 1 from public.trial_cells c
        where c.request_id = new.request_id and c.finished_at is null
      );
  elsif new.stage = 'edited' then
    update public.content_requests
    set status = 'edited'
    where id = new.request_id and status in ('requested', 'shooted');
  end if;
  return new;
end;
$$;
