-- Add moderation status and reasons to reviews, and allow the developer account
-- to inspect, approve, or reject suspicious reviews.

alter table public.reviews
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('approved', 'pending', 'rejected')),
  add column if not exists moderation_reasons text[] not null default '{}';

create index if not exists reviews_moderation_status_idx
  on public.reviews (moderation_status, updated_at desc);

drop policy if exists "public reviews and own reviews are readable" on public.reviews;
drop policy if exists "developer can review public posts" on public.reviews;
drop policy if exists "developer can moderate public posts" on public.reviews;
drop policy if exists "developer can remove public posts" on public.reviews;

create policy "approved public reviews, own reviews, and developer queue are readable"
  on public.reviews for select
  using (
    (is_public and moderation_status = 'approved')
    or profile_id = (select auth.uid())
    or (select public.is_app_developer())
  );

create policy "developer can moderate any review"
  on public.reviews for update to authenticated
  using ((select public.is_app_developer()))
  with check ((select public.is_app_developer()));

create policy "developer can remove any review"
  on public.reviews for delete to authenticated
  using ((select public.is_app_developer()));

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
where is_public and moderation_status = 'approved'
group by game_id, genre_id;

create or replace function public.developer_moderate_review(target_review_id uuid, action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row jsonb;
begin
  if not public.is_app_developer() then
    raise exception 'Только разработчик приложения может модерировать рецензии.';
  end if;

  if action = 'approve' then
    update public.reviews
    set moderation_status = 'approved',
        is_public = true,
        moderation_reasons = '{}',
        updated_at = pg_catalog.now()
    where id = target_review_id
    returning to_jsonb(reviews.*) into result_row;
  elsif action = 'reject' then
    update public.reviews
    set moderation_status = 'rejected',
        is_public = false,
        updated_at = pg_catalog.now()
    where id = target_review_id
    returning to_jsonb(reviews.*) into result_row;
  elsif action = 'delete' then
    delete from public.reviews
    where id = target_review_id
    returning to_jsonb(reviews.*) into result_row;
  else
    raise exception 'Неизвестное действие модерации: %', action;
  end if;

  if result_row is null then
    raise exception 'Рецензия не найдена.';
  end if;

  return result_row;
end;
$$;

revoke all on function public.developer_moderate_review(uuid, text) from public;
grant execute on function public.developer_moderate_review(uuid, text) to authenticated;
