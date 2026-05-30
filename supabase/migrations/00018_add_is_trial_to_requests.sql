-- Trial reel flag on content_requests.
-- Marks a request whose output MUST be posted as a trial reel rather
-- than a normal post. Surfaced as a turquoise "?" badge everywhere a
-- request is shown (vault card, schedule slot, request card, etc.)
-- so the poster (model or VA) sees it before downloading + posting.
ALTER TABLE public.content_requests
ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

-- Quick index for filtering by trial in future (e.g. "show all trial reels")
CREATE INDEX IF NOT EXISTS idx_content_requests_trial
  ON public.content_requests(persona_id, is_trial)
  WHERE is_trial = true;
