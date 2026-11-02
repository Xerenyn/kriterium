-- Developer-only editing and full management of any user reviews.
-- Complements developer_moderate_review (approve/reject/delete):
-- this function lets the developer correct text fields, score and
-- publication state of any review.

create or replace function public.developer_edit_review(target_review_id uuid, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row jsonb;
  allowed_status text;
begin
  if not public.is_app_developer() then
    raise exception 'Только разработчик приложения может редактировать рецензии.';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'Патч рецензии должен быть JSON-объектом.';
  end if;

  if patch ? 'moderation_status' then
    allowed_status := lower(coalesce(patch->>'moderation_status', ''));
    if allowed_status not in ('approved', 'pending', 'rejected') then
      raise exception 'Недопустимый статус модерации: %', allowed_status;
    end if;
  end if;

  update public.reviews set
    review_title = case when patch ? 'review_title'
      then left(patch->>'review_title', 120) else reviews.review_title end,
    verdict = case when patch ? 'verdict'
      then left(patch->>'verdict', 4000) else reviews.verdict end,
    pros = case when patch ? 'pros'
      then left(patch->>'pros', 8000) else reviews.pros end,
    cons = case when patch ? 'cons'
      then left(patch->>'cons', 8000) else reviews.cons end,
    score = case when patch ? 'score'
      then least(100, greatest(0, coalesce((patch->>'score')::numeric, reviews.score)))
      else reviews.score end,
    coverage = case when patch ? 'coverage'
      then least(1, greatest(0, coalesce((patch->>'coverage')::numeric, reviews.coverage)))
      else reviews.coverage end,
    criterion_ratings = case when patch ? 'criterion_ratings'
      and jsonb_typeof(patch->'criterion_ratings') = 'object'
      then patch->'criterion_ratings' else reviews.criterion_ratings end,
    moderation_status = case when patch ? 'moderation_status'
      then allowed_status else reviews.moderation_status end,
    moderation_reasons = case when patch ? 'moderation_status'
      and allowed_status = 'approved' then '{}'::text[] else reviews.moderation_reasons end,
    is_public = case when patch ? 'is_public'
      then coalesce((patch->>'is_public')::boolean, reviews.is_public) else reviews.is_public end,
    updated_at = pg_catalog.now()
  where id = target_review_id
  returning to_jsonb(reviews.*) into result_row;

  if result_row is null then
    raise exception 'Рецензия не найдена.';
  end if;

  return result_row;
end;
$$;

revoke all on function public.developer_edit_review(uuid, jsonb) from public, anon;
grant execute on function public.developer_edit_review(uuid, jsonb) to authenticated;
