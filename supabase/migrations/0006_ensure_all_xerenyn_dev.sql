-- Ensure any owner account named xerenyn has developer privileges and the developer badge.

insert into public.app_roles (user_id, role)
select id, 'developer'
from public.profiles
where lower(display_name) = 'xerenyn'
on conflict (user_id) do update set role = 'developer';

update public.profiles
set badges = jsonb_build_array(
  jsonb_build_object(
    'id', 'developer_kriterium',
    'title', 'Разработчик Критериум',
    'description', 'Создатель и единственный владелец платформы «Критериум»',
    'icon', 'crown',
    'style', 'gold',
    'granted_at', pg_catalog.now()
  )
)
where lower(display_name) = 'xerenyn'
  and jsonb_array_length(badges) = 0;
