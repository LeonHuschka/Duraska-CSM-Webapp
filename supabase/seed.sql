-- Seed data for local development
-- Run via: supabase db reset (applies migrations then seed)
--
-- This creates a demo user in auth.users which triggers the
-- handle_new_user() function to create the user_profile.
-- Then we promote them to owner and create demo data.

-- Create demo auth user (password: "password123")
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud
) values (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  '00000000-0000-0000-0000-000000000000',
  'owner@demo.local',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"full_name": "Demo Owner"}'::jsonb,
  now(),
  now(),
  'authenticated',
  'authenticated'
) on conflict (id) do nothing;

-- Promote to global owner
update public.user_profiles
set global_role = 'owner', full_name = 'Demo Owner'
where id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- Create personas
insert into public.personas (id, name, slug, avatar_url, brand_color, platforms) values
  ('11111111-1111-1111-1111-111111111111', 'Mila', 'mila', null, '#ec4899', '["instagram", "fansly", "tiktok"]'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'Elisa', 'elisa', null, '#8b5cf6', '["instagram", "fansly"]'::jsonb)
on conflict (id) do nothing;

-- Add owner as member of both personas
insert into public.persona_members (persona_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'owner')
on conflict do nothing;

-- Create 10 sample content requests across all statuses
insert into public.content_requests (id, persona_id, title, description, status, priority, due_date, created_by, position) values
  -- Mila requests
  ('aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Beach sunset shoot', 'Golden hour session at Malibu pier. Bring the white dress and flower crown.',
   'requested', 'high', current_date + interval '3 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1000),

  ('aaaa0001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Morning routine reel', 'Casual morning routine vlog for TikTok. 60-90 seconds.',
   'shooted', 'normal', current_date + interval '5 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2000),

  ('aaaa0001-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Gym workout series', 'Part 3 of the fitness series. Focus on legs day.',
   'edited', 'normal', current_date + interval '7 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3000),

  ('aaaa0001-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Product review - skincare', 'Sponsored post for GlowUp serum. Include before/after.',
   'scheduled', 'high', current_date + interval '2 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 4000),

  ('aaaa0001-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Q&A story session', 'Instagram stories answering fan questions from last week.',
   'posted', 'low', current_date - interval '2 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 5000),

  -- Elisa requests
  ('aaaa0002-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Studio photoshoot', 'Professional studio session. Dark aesthetic, neon lighting.',
   'requested', 'high', current_date + interval '4 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1000),

  ('aaaa0002-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'ASMR video', 'Whispering + tapping. 10 minutes. Fansly exclusive.',
   'shooted', 'normal', current_date + interval '6 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2000),

  ('aaaa0002-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Dance transition reel', 'Trending audio transition. 3 outfit changes.',
   'edited', 'high', current_date + interval '1 day',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3000),

  ('aaaa0002-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'Cooking collab', 'Cooking video with another creator. Need to finalize recipe.',
   'scheduled', 'normal', current_date + interval '8 days',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 4000),

  ('aaaa0002-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   'Behind the scenes', 'BTS from studio photoshoot. Quick edit for IG stories.',
   'posted', 'low', current_date - interval '1 day',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 5000)
on conflict (id) do nothing;
