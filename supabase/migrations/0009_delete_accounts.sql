-- 0009: Удаление аккаунтов по решению владельца (2026-11-04).
-- Убираем пользователя "bots" и зеркальный дубль аккаунта владельца
-- (второй профиль с ником xerenyn). Основной аккаунт разработчика
-- (founder_1) и аккаунт AnarchistLS с наградой "Beta test" не трогаются.
-- Удаление идёт из auth.users: профили, рецензии и роли сносятся каскадом
-- (profiles.id и user-таблицы ссылаются на auth.users on delete cascade).
do $$
declare
  removed_count int;
begin
  delete from auth.users
  where id in (
    '29dfe668-4091-4527-8fc6-71aac782f8dc',  -- handle: bots
    'b0d2e78a-096a-4c17-8a3d-8c1107b8347a'   -- handle: player_b0d2e78a (зеркальный xerenyn)
  );
  get diagnostics removed_count = row_count;
  raise notice 'deleted_auth_users=%', removed_count;
end;
$$;
