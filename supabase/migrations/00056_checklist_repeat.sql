-- Checklist entries come back: a tick holds for one day, seven days, thirty
-- days, or for good ('all'). Daily is what the list is mostly for.
alter table public.checklist_items add column if not exists repeat text not null default '1d';
alter table public.checklist_items drop constraint if exists checklist_items_repeat_check;
alter table public.checklist_items add constraint checklist_items_repeat_check check (repeat in ('all', '1d', '7d', '30d'));
