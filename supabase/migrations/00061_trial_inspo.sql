-- The inspo the viral reel was shot from, so its Trial-Maxxing jobs can
-- show the original next to the reel that went viral.
alter table public.trials add column if not exists inspo_link text;
alter table public.trials add column if not exists inspo_video_path text;
