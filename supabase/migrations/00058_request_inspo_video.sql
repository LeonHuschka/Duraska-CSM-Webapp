-- A job the model started on the upload page with an inspo link never went
-- through the Telegram topic, so nothing kept the reel. Its copy lives on
-- the job itself.
alter table public.content_requests add column if not exists inspo_video_path text;
alter table public.content_requests add column if not exists inspo_video_error text;
