-- Kriterium shared catalog, community profiles and personal game reviews.
-- Safe to run once in Supabase SQL Editor. Never put the service_role key in the desktop app.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Игрок' check (char_length(display_name) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 280),
  avatar text not null default '🎮' check (char_length(avatar) <= 16),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- This table is intentionally private: clients cannot grant themselves a role.
-- Add the sole developer account through Supabase SQL Editor after signup (see bootstrap-developer.sql).
create table if not exists public.app_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('developer')),
  granted_at timestamptz not null default now()
);

create or replace function public.is_app_developer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_roles r
    where r.user_id = (select auth.uid()) and r.role = 'developer'
  );
$$;

revoke all on function public.is_app_developer() from public;
grant execute on function public.is_app_developer() to anon, authenticated;

create table if not exists public.games (
  id uuid primary key default extensions.gen_random_uuid(),
  steam_app_id bigint not null unique check (steam_app_id > 0),
  title text not null check (char_length(title) between 1 and 200),
  slug text not null unique,
  description text not null default '',
  release_date date,
  developers jsonb not null default '[]'::jsonb,
  publishers jsonb not null default '[]'::jsonb,
  genres text[] not null default '{}',
  platforms text[] not null default '{}',
  header_image text not null default '',
  store_url text not null default '',
  source_data jsonb not null default '{}'::jsonb,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_ratings (
  game_id uuid not null references public.games (id) on delete cascade,
  source text not null check (source in ('steam', 'metacritic', 'opencritic')),
  score numeric(6,2) not null check (score >= 0),
  max_score numeric(6,2) not null default 100 check (max_score > 0),
  vote_count integer check (vote_count is null or vote_count >= 0),
  url text not null default '',
  fetched_at timestamptz not null default now(),
  source_data jsonb not null default '{}'::jsonb,
  primary key (game_id, source)
);

-- Curated, application-wide patches. Unlike a user's local extensions, these affect everyone.
create table if not exists public.app_patches (
  patch_id text primary key check (patch_id ~ '^[a-zA-Z0-9._-]{3,80}$'),
  name text not null check (char_length(name) between 1 and 120),
  version text not null default '1.0.0',
  description text not null default '' check (char_length(description) <= 2000),
  operations jsonb not null check (jsonb_typeof(operations) = 'array'),
  is_enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  genre_id text not null,
  score numeric(5,2) not null check (score between 0 and 100),
  coverage numeric(5,4) not null default 0 check (coverage between 0 and 1),
  scoring_version text not null default '1.0.0',
  official_patch_ids text[] not null default '{}',
  review_title text not null default '' check (char_length(review_title) <= 120),
  verdict text not null default '' check (char_length(verdict) <= 4000),
  pros text not null default '' check (char_length(pros) <= 8000),
  cons text not null default '' check (char_length(cons) <= 8000),
  criterion_ratings jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, game_id)
);

create index if not exists games_title_search_idx on public.games using gin (to_tsvector('simple', title));
create index if not exists reviews_game_public_idx on public.reviews (game_id, is_public, updated_at desc);
create index if not exists reviews_profile_idx on public.reviews (profile_id, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute procedure public.touch_updated_at();
create trigger games_touch_updated_at before update on public.games
  for each row execute procedure public.touch_updated_at();
create trigger reviews_touch_updated_at before update on public.reviews
  for each row execute procedure public.touch_updated_at();
create trigger app_patches_touch_updated_at before update on public.app_patches
  for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.app_roles enable row level security;
alter table public.games enable row level security;
alter table public.external_ratings enable row level security;
alter table public.app_patches enable row level security;
alter table public.reviews enable row level security;

-- No client-side policies or grants on app_roles: only the project owner/service role can change roles.
revoke all on public.app_roles from anon, authenticated;

-- Public profiles and profiles visible to their owner.
create policy "public profiles are readable"
  on public.profiles for select
  using (is_public or id = (select auth.uid()));
create policy "users update their own profile"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- The Steam catalog is readable without an account. Authenticated users may add a missing game;
-- only the developer account may edit or remove shared catalog rows.
create policy "game catalog is readable"
  on public.games for select
  using (true);
create policy "signed-in users can add games"
  on public.games for insert to authenticated
  with check (added_by = (select auth.uid()));
create policy "only developer edits catalog pages"
  on public.games for update to authenticated
  using ((select public.is_app_developer()))
  with check ((select public.is_app_developer()));
create policy "only developer removes catalog pages"
  on public.games for delete to authenticated
  using ((select public.is_app_developer()));

-- External scores are public read-only data. Only the developer account may publish or change them.
create policy "external ratings are readable"
  on public.external_ratings for select
  using (true);
create policy "only developer publishes external ratings"
  on public.external_ratings for insert to authenticated
  with check ((select public.is_app_developer()));
create policy "only developer edits external ratings"
  on public.external_ratings for update to authenticated
  using ((select public.is_app_developer()))
  with check ((select public.is_app_developer()));
create policy "only developer removes external ratings"
  on public.external_ratings for delete to authenticated
  using ((select public.is_app_developer()));

create policy "enabled application patches are readable"
  on public.app_patches for select
  using (is_enabled or (select public.is_app_developer()));
create policy "only developer publishes application patches"
  on public.app_patches for insert to authenticated
  with check ((select public.is_app_developer()) and created_by = (select auth.uid()));
create policy "only developer edits application patches"
  on public.app_patches for update to authenticated
  using ((select public.is_app_developer()))
  with check ((select public.is_app_developer()));
create policy "only developer removes application patches"
  on public.app_patches for delete to authenticated
  using ((select public.is_app_developer()));

-- A review is visible publicly only when both the review and its profile are public.
create policy "public reviews and own reviews are readable"
  on public.reviews for select
  using (
    profile_id = (select auth.uid())
    or (
      is_public
      and exists (
        select 1 from public.profiles p
        where p.id = reviews.profile_id and p.is_public
      )
    )
  );
create policy "users create their own reviews"
  on public.reviews for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "users update their own reviews"
  on public.reviews for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy "users delete their own reviews"
  on public.reviews for delete to authenticated
  using (profile_id = (select auth.uid()));
create policy "developer can review public posts"
  on public.reviews for select to authenticated
  using ((select public.is_app_developer()) and is_public);
create policy "developer can moderate public posts"
  on public.reviews for update to authenticated
  using ((select public.is_app_developer()) and is_public)
  with check ((select public.is_app_developer()));
create policy "developer can remove public posts"
  on public.reviews for delete to authenticated
  using ((select public.is_app_developer()) and is_public);

-- A signup trigger creates a private-by-default account profile with a collision-safe handle.
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
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

-- Aggregate page data contains no private profile information.
create or replace view public.game_rating_summary
with (security_invoker = true)
as
select
  game_id,
  genre_id,
  count(*)::integer as review_count,
  round(avg(score), 1) as average_score,
  round(avg(coverage) * 100)::integer as average_coverage
from public.reviews
where is_public
group by game_id, genre_id;

grant select on public.profiles, public.games, public.external_ratings, public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
revoke insert, update on public.profiles from authenticated;
grant update (handle, display_name, bio, avatar, is_public) on public.profiles to authenticated;
grant insert, update, delete on public.games to authenticated;
grant insert, update, delete on public.external_ratings to authenticated;
grant select, insert, update, delete on public.app_patches to authenticated;
grant select on public.game_rating_summary to anon, authenticated;
