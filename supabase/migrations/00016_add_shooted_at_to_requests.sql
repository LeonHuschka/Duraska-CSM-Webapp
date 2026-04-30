-- Track when a request was shot (status changed to "shooted")
-- so we can count accurate weekly shoot totals independent of current status.
ALTER TABLE public.content_requests
  ADD COLUMN IF NOT EXISTS shooted_at timestamptz;

-- Backfill: requests currently in "shooted" get updated_at as best approximation
UPDATE public.content_requests
  SET shooted_at = updated_at
  WHERE status = 'shooted' AND shooted_at IS NULL;
