-- Add server-protected profile achievements (badges) and grant "Разработчик Критериум" to the developer account.
-- Because authenticated users only have column-level UPDATE privileges on (handle, display_name, bio, avatar, is_public),
-- no user can forge or modify their own badges from the client.

alter table public.profiles
  add column if not exists badges jsonb not null default '[]'::jsonb;

update public.profiles
set badges = jsonb_build_array(
  jsonb_build_object(
    'id', 'developer_kriterium',
    'title', 'Разработчик Критериум',
    'description', 'Создатель и единственный владелец платформы «Критериум»',
    'icon', '👑',
    'granted_at', pg_catalog.now()
  )
)
where id in (
  select user_id from public.app_roles where role = 'developer'
);
