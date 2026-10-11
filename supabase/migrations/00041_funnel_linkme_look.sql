-- The landing page in the link.me layout: cover photo, name and handle,
-- social icon, follower total, one picture card as the button.
alter table public.funnel_pages
  add column if not exists handle text,                  -- "@sarahprice" under the name
  add column if not exists instagram_url text,           -- the icon under the name
  add column if not exists show_followers boolean not null default true,
  add column if not exists button_image_path text;       -- the picture on the button card
