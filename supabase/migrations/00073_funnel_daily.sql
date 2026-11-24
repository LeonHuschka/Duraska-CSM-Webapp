-- The link page's people per UTC day, counted in the database: a busy day
-- alone has more events than one API request may return, so the dashboard
-- asks for the totals instead of the rows. Bots are left out; a gate view is
-- any view that is not page 2 ("open"), as in funnel-dashboard.ts.
create or replace function public.funnel_daily(
  p_page uuid,
  p_since timestamptz,
  p_skip text[] default '{}'
)
returns table (day date, gate_views int, opened int, clicks int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (e.created_at at time zone 'utc')::date as day,
    (count(*) filter (where e.kind = 'view' and coalesce(e.reason, '') <> 'open'))::int,
    (count(*) filter (where e.kind = 'view' and e.reason = 'open'))::int,
    (count(*) filter (where e.kind = 'click'))::int
  from funnel_events e
  where e.page_id = p_page
    and e.created_at >= p_since
    and not e.bot
    and (e.country is null or not (upper(e.country) = any (p_skip)))
  group by 1
  order by 1
$$;

grant execute on function public.funnel_daily(uuid, timestamptz, text[]) to authenticated, service_role;
