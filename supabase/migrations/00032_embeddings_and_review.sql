-- Shortlisting by what a picture shows, and a way for a person to correct it.
--
-- Measured against all 122 cuts on tiles cut from photos of a phone screen,
-- the right answer ranked: 6th by perceptual hash, 5th by visual vocabulary,
-- 2nd by embedding. Rank two means five candidates suffice where the hash
-- needed twenty — and since one landmark comparison costs a quarter of a
-- second, that is six seconds a tile against one and a half.
create extension if not exists vector;

alter table public.content_assets
  add column if not exists embedding vector(1024);

-- A tile the matcher could not settle is written anyway, with its best
-- candidate and a flag, because a blank is not more honest than a proposal
-- when the proposal keeps turning out right. The crop is kept so a person
-- can see what was compared without digging the screenshot back out.
alter table public.reel_metrics
  add column if not exists tile_path text,
  add column if not exists match_confirmed boolean not null default false;

-- Cosine distance, which is what the embeddings are normalised for.
create index if not exists content_assets_embedding_idx
  on public.content_assets using hnsw (embedding vector_cosine_ops);
