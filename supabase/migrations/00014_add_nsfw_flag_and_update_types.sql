-- Add NSFW flag to content_requests (default false = SFW)
ALTER TABLE public.content_requests ADD COLUMN IF NOT EXISTS is_nsfw boolean NOT NULL DEFAULT false;

-- Mark all existing entries as NSFW (they were all Fansly-only content)
UPDATE public.content_requests SET is_nsfw = true;

-- Clear content_type_id references before deleting old types
UPDATE public.content_requests SET content_type_id = null;

-- Delete old content types
DELETE FROM public.content_types;
