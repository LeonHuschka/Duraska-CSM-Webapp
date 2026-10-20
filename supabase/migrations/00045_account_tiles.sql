-- The accounts tab as tiles.
--
--   avatar_path        the account's profile picture, copied into our own
--                      storage at scrape time; the platforms' links expire
--   sort_order         the order a manager dragged the tiles into
--   linked_account_id  the other half of a Meta setup: the Facebook page
--                      and the Instagram account linked in one Meta login
alter table public.accounts
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz,
  add column if not exists sort_order integer,
  add column if not exists linked_account_id uuid references public.accounts(id) on delete set null;

-- A reel's cover, copied into storage the first time it is scraped. The
-- CDN address in tile_path stops working after a few days.
alter table public.reel_metrics
  add column if not exists cover_path text;

-- The two Meta setups already running: each VA's Facebook page and
-- Instagram account belong together.
update public.accounts fb set linked_account_id = ig.id
from public.accounts ig
where fb.persona_id = ig.persona_id
  and fb.platform = 'facebook' and ig.platform = 'instagram'
  and fb.manager_username is not null and fb.manager_username = ig.manager_username
  and fb.linked_account_id is null
  and (select count(*) from public.accounts x where x.persona_id = fb.persona_id and x.platform = 'instagram' and x.manager_username = fb.manager_username) = 1
  and (select count(*) from public.accounts x where x.persona_id = fb.persona_id and x.platform = 'facebook' and x.manager_username = fb.manager_username) = 1;
update public.accounts ig set linked_account_id = fb.id
from public.accounts fb
where fb.linked_account_id = ig.id and ig.linked_account_id is null;
