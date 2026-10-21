-- The outlier's video, copied into storage when the trial starts, so the
-- matrix can play the reel she is reshooting.
alter table public.trials add column if not exists video_path text;
