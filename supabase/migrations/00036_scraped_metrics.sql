-- Numbers read from the platforms themselves, not off screenshots.
--
-- The screenshot pipeline matched grid tiles to our cuts by picture and by
-- position, and neither is an identity: a tile that could not be matched
-- was keyed on where it sat in the picture, which is a different place
-- every morning, so one reel turned into five rows. A scrape names each
-- post by the platform's own id, and that key never moves.
--
-- Both tables keep their shape. Rows from a scrape carry source = 'scrape'
-- and, on reel_metrics, the post's id and url plus the counts a screenshot
-- never showed: comments, shares, and when the post went up.

alter table public.reel_metrics
  add column if not exists shortcode text,
  add column if not exists post_url text,
  add column if not exists comments bigint,
  add column if not exists shares bigint,
  add column if not exists posted_at timestamptz,
  add column if not exists source text not null default 'screenshot';

create index if not exists idx_reel_metrics_scrape
  on public.reel_metrics(account_id, source, captured_at desc);

create index if not exists idx_reel_metrics_shortcode
  on public.reel_metrics(account_id, shortcode);

alter table public.account_metrics
  add column if not exists source text not null default 'screenshot';

create index if not exists idx_account_metrics_scrape
  on public.account_metrics(account_id, source, captured_at desc);
