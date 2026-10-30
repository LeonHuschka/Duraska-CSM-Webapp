-- What the editor should change or add on a job, as a small checklist the
-- team writes and the editor ticks: [{ id, text, done }].
alter table public.content_requests add column if not exists edit_notes jsonb not null default '[]'::jsonb;
