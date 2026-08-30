-- Remember that a post exists but cannot be seen from here.
--
-- The cheap scraper cannot tell a deleted post from a private, suspended or
-- age-restricted one; the expensive one can, at nine times the price. Asking
-- the expensive one every run was buying the same answer over and over —
-- roughly ten cents a run — because a hidden post stays hidden. It does not
-- quietly become deleted while nobody is looking, and if it is still hidden
-- a month later the age rule removes it anyway.
--
-- So the answer is kept. This flag means "the expensive pass has seen this
-- one and it exists", and links carrying it are never sent there again.
-- Distinct from link_ok, which is also set by the cheap pass and only says
-- the post was reachable — a link the cheap pass could see needs no second
-- opinion at all, and a link that stops being publicly visible must still
-- get one.

alter table public.content_links
  add column if not exists hidden_confirmed boolean not null default false;
