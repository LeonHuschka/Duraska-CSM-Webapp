-- Allows looking up a user ID by email for the invite flow.
-- Security definer so it can access auth.users without exposing the table.
create or replace function public.get_user_id_by_email(email_input text)
returns uuid
language sql
security definer set search_path = ''
stable
as $$
  select id from auth.users where email = email_input limit 1;
$$;
