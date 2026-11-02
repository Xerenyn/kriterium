-- Make profiles and their reviews public by default so every participant's reviews
-- are immediately visible on game pages and in the community list.

alter table public.profiles
  alter column is_public set default true;

update public.profiles
set is_public = true
where is_public = false;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Игрок');
  insert into public.profiles (id, handle, display_name, is_public)
  values (
    new.id,
    'player_' || replace(substr(new.id::text, 1, 8), '-', ''),
    left(initial_name, 60),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Allow reading any public review on a game page even if the author hasn't customized their profile yet.
drop policy if exists "public reviews and own reviews are readable" on public.reviews;
create policy "public reviews and own reviews are readable"
  on public.reviews for select
  using (
    is_public
    or profile_id = (select auth.uid())
  );

-- Clean up temporary diagnostic test user if present.
delete from auth.users
where email like 'test_friend_%@gmail.com';
