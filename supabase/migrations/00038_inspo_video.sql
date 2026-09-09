-- The inspo reel itself, saved the moment its link is posted. Instagram
-- posts vanish; the copy in our storage does not, and the model watches
-- it in the group instead of following a link that may already be dead.
alter table public.content_links
  add column if not exists video_path text,
  add column if not exists video_size bigint,
  add column if not exists video_fetched_at timestamptz,
  add column if not exists video_error text,
  add column if not exists video_message_id bigint;
