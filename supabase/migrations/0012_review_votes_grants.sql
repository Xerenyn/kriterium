-- 0012: табличные права на голоса (RLS-политики в 0011 не дают грантов PostgREST).
-- Чтение агрегатов идёт через функцию get_review_votes, поэтому anon прямого доступа не имеет.
grant select, insert, update, delete on public.review_votes to authenticated;
