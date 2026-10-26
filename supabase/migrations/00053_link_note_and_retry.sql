-- What the sender wrote beside an inspo link, kept with it: when the reel
-- could not be fetched at once (Apify out of budget, say), the morning run
-- tries again and the reposted video still carries the note.
alter table public.content_links add column if not exists note text;
