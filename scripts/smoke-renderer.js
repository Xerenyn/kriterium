(async () => {
  const checks = []
  const check = (name, condition, extra) => {
    checks.push({ name, pass: !!condition, extra: extra === undefined ? null : extra })
    return !!condition
  }

  const K = window.K
  const api = window.krit

  check('window.K загружен', K && K.scoring && K.util && K.app)
  check('профиль загружен', K.app.profile && typeof K.app.profile.nickname === 'string')

  const setupSql = await api.cloud.setupSql()
  const developerSql = await api.cloud.bootstrapSql('owner@example.com')
  check('SQL-схема Supabase доступна из приложения', setupSql.includes('public.app_patches') && setupSql.includes('create table if not exists public.games'))
  check('скрипт разработчика подставляет владельца', developerSql.includes("owner@example.com") && !developerSql.includes('REPLACE-WITH-OWNER-EMAIL'))

  const base = K.app.base
  const criteriaCount = base.categories.reduce((n, c) => n + c.criteria.length, 0)
  check('126 критериев в ядре', criteriaCount === 126, criteriaCount)
  check('19 категорий', base.categories.length === 19, base.categories.length)
  check('30 жанров', base.genres.length === 30, base.genres.length)

  // Жанровые множители: сюжет в RPG должен весить больше, чем в гонках.
  const rpg = K.scoring.buildCatalog(base, [], 'rpg')
  const racing = K.scoring.buildCatalog(base, [], 'racing')
  const rpgNarr = rpg.categories.find((c) => c.id === 'narrative')
  const racingNarr = racing.categories.find((c) => c.id === 'narrative')
  check('сюжет в RPG весит больше, чем в гонках', rpgNarr.points > racingNarr.points, { rpg: rpgNarr.points, racing: racingNarr.points })

  const tierSums = rpg.tiers.map((t) => rpg.categories.filter((c) => c.tier === t.id).reduce((n, c) => n + c.points, 0))
  check('уровни дают ровно 60/25/15', Math.abs(tierSums[0] - 60) < 0.001 && Math.abs(tierSums[1] - 25) < 0.001 && Math.abs(tierSums[2] - 15) < 0.001, tierSums)

  // Все десятки => 100, все нули => 0.
  const allRatings = (value) => {
    const ratings = {}
    for (const cat of rpg.categories) for (const crit of cat.criteria) ratings[crit.id] = { v: value, na: false }
    return ratings
  }
  const perfect = K.scoring.computeScore(rpg, allRatings(10))
  const zero = K.scoring.computeScore(rpg, allRatings(0))
  check('все 10 => 100 баллов', Math.abs(perfect.total - 100) < 0.001, perfect.total)
  check('все 0 => 0 баллов', Math.abs(zero.total) < 0.001, zero.total)
  check('покрытие 100%', Math.abs(perfect.coverage - 1) < 0.001, perfect.coverage)

  // «н/п» исключает критерий из знаменателя.
  const naRatings = allRatings(8)
  const socialCat = rpg.categories.find((c) => c.id === 'social')
  for (const crit of socialCat.criteria) naRatings[crit.id] = { na: true, v: null }
  const withNa = K.scoring.computeScore(rpg, naRatings)
  check('н/п уменьшает число применимых критериев', withNa.applicable < perfect.applicable, { withNa: withNa.applicable, perfect: perfect.applicable })
  check('балл без соцсети остаётся 80', Math.abs(withNa.total - 80) < 0.001, withNa.total)

  // Сохранение игры через API.
  const smokeGame = await api.games.save(
    { title: 'SMOKE TEST GAME', genre: 'puzzle', year: 2026, status: 'playing', hours: 1.5, verdict: 'тест', custom: {} },
    { 'core.loop': { v: 7, na: false }, 'audio.score': { v: 9, na: false } }
  )
  check('игра сохранилась и получила id', smokeGame && smokeGame.id, smokeGame && smokeGame.id)
  const listed = await api.games.list()
  check('игра есть в списке', listed.some((g) => g.id === smokeGame.id))
  const savedRatings = await api.ratings.get(smokeGame.id)
  check('оценки сохранились', savedRatings['core.loop'] && savedRatings['core.loop'].v === 7, savedRatings)

  // Патч: добавляем критерий, проверяем каталог, удаляем.
  await api.patches.save({
    id: 'smoke.patch',
    name: 'Smoke patch',
    version: '1.0.0',
    operations: [
      { op: 'addCriterion', categoryId: 'audio', criterion: { id: 'smoke.crit', name: 'Тестовый критерий', w: 1, hint: '' } },
      { op: 'updateGenre', id: 'racing', patch: { profile: { narrative: 0.5 } } }
    ]
  })
  await K.app.refresh()
  const patched = K.app.catalog('racing')
  check('патч добавил критерий', patched.categories.some((c) => c.criteria.some((cr) => cr.id === 'smoke.crit')))
  check('патч изменил профиль жанра', patched.categories.find((c) => c.id === 'narrative').multiplier === 0.5, patched.categories.find((c) => c.id === 'narrative').multiplier)
  await api.patches.remove('smoke.patch')
  await K.app.refresh()
  check('патч удаляется', !K.app.catalog('racing').categories.some((c) => c.criteria.some((cr) => cr.id === 'smoke.crit')))

  // Маршруты.
  const routes = ['#/patches', '#/profile', '#/settings', '#/new', '#/library', '#/overview', '#/catalog', '#/community', '#/account', '#/review/440']
  for (const route of routes) {
    location.hash = route
    await new Promise((r) => setTimeout(r, 260))
    const view = document.querySelector('#view')
    check('маршрут ' + route + ' рендерится', view && view.innerText.trim().length > 20)
  }

  // Редактор: поля и критерии на месте.
  location.hash = '#/new'
  await new Promise((r) => setTimeout(r, 260))
  check('в редакторе есть поле названия', !!document.querySelector('[data-field="title"]'))
  check('в редакторе есть ползунки', document.querySelectorAll('[data-range]').length > 0)

  // Удаляем тестовую игру.
  await api.games.remove(smokeGame.id)
  await K.app.refresh()
  check('тестовая игра удалена', !K.app.games.some((g) => g.id === smokeGame.id))

  const failed = checks.filter((c) => !c.pass)
  return { ok: failed.length === 0, total: checks.length, failed: failed.length, checks }
})()
