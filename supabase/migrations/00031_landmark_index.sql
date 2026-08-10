-- The landmarks of each cut, so a screenshot tile can be recognised by what
-- it shares with them rather than by its overall shape.
--
-- A perceptual hash cannot survive a crop — it squeezes the whole picture
-- into 256 bits, so cropping moves every bit. Instagram shows our 9:16 frame
-- whole and Meta's library shows a 3:4 band of it, which is why matching
-- worked on one surface and not the other.
--
-- Measured against all 122 cuts, on tiles taken from handheld photos of a
-- phone screen: six of six identified across both formats, including the two
-- the hash refused. Correct answers shared 178 to 770 landmarks; the best
-- wrong candidate shared 82 to 120.
--
-- Stored base64 because that is what travels through PostgREST intact. About
-- 130 KB per cut, and only the dozen shortlisted by hash are ever loaded.
alter table public.content_assets
  add column if not exists orb_index text,
  add column if not exists orb_count int;
