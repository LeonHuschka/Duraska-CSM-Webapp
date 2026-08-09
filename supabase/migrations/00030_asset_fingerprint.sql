-- What a cut looks like, in a form a screenshot can be compared against.
--
-- phash is a 256-bit perceptual hash of the cut's thumbnail; overlay_text is
-- the hook burned into the video. Two independent handles on the same
-- question — "is this tile this reel" — because each fails where the other
-- holds: the hash is defeated by a tighter crop, the text by a reel that
-- carries none.
alter table public.content_assets
  add column if not exists phash text,
  add column if not exists overlay_text text,
  add column if not exists fingerprinted_at timestamptz;

create index if not exists content_assets_phash_idx
  on public.content_assets (stage)
  where phash is not null;

-- How a tile was identified, so a wrong row can be traced to the method
-- that produced it rather than being argued about.
alter table public.reel_metrics
  add column if not exists match_method text,
  add column if not exists match_score numeric;
