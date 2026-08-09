-- A fingerprint per crop window, not one for the whole frame.
--
-- Instagram's grid shows our 9:16 frame whole; Meta's library shows a 3:4
-- band of it. One fingerprint of the whole frame cannot recognise a band of
-- itself — cropped to 3:4, the same picture scored 51 to 110 against its own
-- stored hash, close enough to wrong answers that one of six matched the
-- wrong reel and the rest would have been refused.
--
-- Measured with the windows in place, on crops deliberately placed between
-- them: 24 of 24 identified, best-to-runner-up 0.21 to 0.64 against a limit
-- of 0.8. Costs nothing to move — the hashes come from the thumbnail the
-- fingerprint job already fetches.
alter table public.content_assets
  add column if not exists phashes text[];
