-- 0011: Голосование за рецензии (лайк/дизлайк) и их поднятие в топ.
-- Голос один на пару «рецензия — пользователь»: 1 = лайк, -1 = дизлайк.
-- Повторный клик по тому же голосу отзывает его.

create table if not exists public.review_votes (
  review_id uuid not null references public.reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

alter table public.review_votes enable row level security;
revoke all on public.review_votes from anon, authenticated;

-- Пользователь управляет только своим голосом
drop policy if exists "own review votes" on public.review_votes;
create policy "own review votes" on public.review_votes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Агрегированные голоса по набору рецензий: сколько лайков/дизлайков и голос зрителя.
-- security definer, чтобы гости тоже видели счётчики (свой голос при этом всегда 0).
create or replace function public.get_review_votes(review_ids uuid[])
returns table (review_id uuid, likes bigint, dislikes bigint, my_vote smallint)
language sql
security definer
set search_path = ''
stable
as $$
  select
    v.review_id,
    count(*) filter (where v.vote = 1)::bigint as likes,
    count(*) filter (where v.vote = -1)::bigint as dislikes,
    coalesce(max(case when v.user_id = (select auth.uid()) then v.vote end), 0)::smallint as my_vote
  from public.review_votes v
  where v.review_id = any (review_ids)
  group by v.review_id
$$;

revoke all on function public.get_review_votes(uuid[]) from public;
grant execute on function public.get_review_votes(uuid[]) to anon, authenticated;
