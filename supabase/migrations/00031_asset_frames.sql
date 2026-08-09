-- Many fingerprints per cut, not one.
--
-- A grid tile is a frame of our video seen through whatever window the
-- platform crops it to. One stored still could only match a tile that
-- happened to be the same moment in the same shape — measured, a correct
-- match then scored 108 where wrong ones scored 118, which is no signal at
-- all. Fingerprinting several stills through several crop shapes turned the
-- same comparison into 77 against 107.
--
-- frames_path points at a sprite sheet of stills, made in the browser where
-- the video is already decoded, and hashed on the server so both sides of
-- every comparison come from one engine.
alter table public.content_assets
  add column if not exists frames_path text,
  add column if not exists frame_count int,
  add column if not exists phashes text[];
