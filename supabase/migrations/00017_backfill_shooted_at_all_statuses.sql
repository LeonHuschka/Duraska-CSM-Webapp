-- The previous migration (00016) only backfilled requests currently in
-- status='shooted'. Requests that had already moved on to 'edited',
-- 'scheduled', 'posted', or 'archived' were left with shooted_at = NULL
-- and were therefore not counted in the "Shot this week" stat.
--
-- Fix: backfill shooted_at for every request that has passed through
-- the shooted stage (i.e. any status beyond 'requested').

UPDATE public.content_requests
SET shooted_at = updated_at
WHERE shooted_at IS NULL
  AND status IN ('edited', 'scheduled', 'posted', 'archived');
