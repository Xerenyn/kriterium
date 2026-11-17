-- 0010: Вход и привязка через Steam, Discord, Shikimori и Telegram.
-- Google — встроенный провайдер Supabase Auth и хранится в auth.identities.
-- Для остальных провайдеров вход проводит Edge Function auth-bridge: она проверяет
-- ответ провайдера и пишет связь «аккаунт провайдера → пользователь» в эту таблицу.
-- Клиенты могут только читать свои связи; создаёт и удаляет их функция (service role).

create table if not exists public.external_identities (
  provider text not null check (provider in ('steam', 'discord', 'shikimori', 'telegram')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  primary key (provider, provider_user_id),
  unique (user_id, provider)
);

alter table public.external_identities enable row level security;
revoke all on public.external_identities from anon, authenticated;
grant select on public.external_identities to authenticated;

drop policy if exists "users read own external identities" on public.external_identities;
create policy "users read own external identities"
  on public.external_identities for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Незавершённые входы через auth-bridge. Только для service role: клиент знает
-- id попытки и свой секрет state, но читает результат исключительно через функцию.
create table if not exists public.auth_bridge_flows (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('steam', 'discord', 'shikimori', 'telegram')),
  mode text not null check (mode in ('login', 'link')),
  link_user_id uuid references auth.users (id) on delete cascade,
  redirect_port integer not null check (redirect_port between 1024 and 65535),
  client_state text not null check (char_length(client_state) between 16 and 128),
  confirm_code text,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  check (mode = 'login' or link_user_id is not null)
);

alter table public.auth_bridge_flows enable row level security;
revoke all on public.auth_bridge_flows from anon, authenticated;

-- Имя в профиле для входа через Google / Discord: они присылают full_name / name,
-- а не display_name, из-за чего все новые участники назывались «Игрок».
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    'Игрок'
  );
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
