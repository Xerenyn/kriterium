-- Run in Supabase SQL Editor only after creating the developer account in Kriterium.
-- Replace the email below with the owner's verified signup email.
-- This script must be run by the Supabase project owner, never from the desktop app.

do $$
declare
  owner_email text := lower('REPLACE-WITH-OWNER-EMAIL@example.com');
  owner_id uuid;
begin
  select id into owner_id
  from auth.users
  where lower(email) = owner_email
    and email_confirmed_at is not null;

  if owner_id is null then
    raise exception 'No Supabase account found for %. Sign up in Kriterium first.', owner_email;
  end if;

  insert into public.app_roles (user_id, role)
  values (owner_id, 'developer')
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
