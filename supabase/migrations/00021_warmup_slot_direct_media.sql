-- Warm-up slots get their own directly-uploaded media, fully decoupled
-- from the Vault / content_assets. The model drags a file straight onto a
-- slot; it's stored under personas/{personaId}/warmup/... and referenced
-- here. asset_id stays for backward-compat but is no longer used by the UI.
alter table public.warmup_slots
  add column if not exists file_name   text,
  add column if not exists file_path   text,
  add column if not exists mime_type   text,
  add column if not exists size_bytes  bigint,
  add column if not exists thumbnail_path text;
