-- 1. Grant the "Beta test" badge to AnarchistLS (@player_249332fe).
-- 2. Add a server-verified RPC function so the developer account can grant or revoke badges from the app UI.

update public.profiles
set badges = jsonb_build_array(
  jsonb_build_object(
    'id', 'beta_test',
    'title', 'Beta test',
    'description', 'Первопроходец и участник закрытого бета-тестирования «Критериума»',
    'icon', 'beta',
    'style', 'emerald',
    'granted_at', pg_catalog.now()
  )
)
where handle = 'player_249332fe'
   or lower(display_name) = 'anarchistls';

create or replace function public.developer_set_profile_badges(target_handle text, new_badges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_row jsonb;
begin
  if not public.is_app_developer() then
    raise exception 'Только разработчик приложения может выдавать награды.';
  end if;

  if jsonb_typeof(new_badges) <> 'array' then
    raise exception 'Список наград должен быть массивом.';
  end if;

  update public.profiles
  set badges = new_badges,
      updated_at = pg_catalog.now()
  where handle = lower(trim(target_handle))
  returning to_jsonb(profiles.*) into updated_row;

  if updated_row is null then
    raise exception 'Профиль не найден.';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.developer_set_profile_badges(text, jsonb) from public;
grant execute on function public.developer_set_profile_badges(text, jsonb) to authenticated;
