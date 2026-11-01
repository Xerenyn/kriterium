-- Confirm the initial owner account, grant the sole developer role,
-- and auto-confirm desktop signups so users can sign in without SMTP delays.

do $$
declare
  first_user_id uuid;
begin
  select id into first_user_id
  from auth.users
  order by created_at asc
  limit 1;

  if first_user_id is not null then
    update auth.users
    set email_confirmed_at = coalesce(email_confirmed_at, pg_catalog.now())
    where id = first_user_id;

    insert into public.app_roles (user_id, role)
    values (first_user_id, 'developer')
    on conflict (user_id) do update set role = 'developer';

    update public.profiles
    set is_public = true
    where id = first_user_id;
  end if;
end;
$$;

create or replace function public.autoconfirm_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_autoconfirm_email on auth.users;
create trigger on_auth_user_autoconfirm_email
  before insert on auth.users
  for each row execute procedure public.autoconfirm_auth_user_email();
