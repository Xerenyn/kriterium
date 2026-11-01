/* Приложение: состояние, маршрутизация, обзор, библиотека, карточка игры */
window.K = window.K || {};

(function () {
  'use strict'

  const U = window.K.util
  const S = window.K.scoring
  const C = window.K.charts
  const api = window.krit

  const app = {
    info: null,
    base: null,
    patches: [],
    profile: { nickname: 'Игрок', tagline: '', avatar: '🎮', accent: '#d8d3c9' },
    games: [],
    ratings: {},
    settings: { showHints: true, step: 0.5 },
    cache: new Map(),
    booted: false,

    catalog(genreId) {
      const key = genreId || '__all'
      if (!this.cache.has(key)) {
        this.cache.set(key, S.buildCatalog(this.base, this.patches, genreId || null))
      }
      return this.cache.get(key)
    },

    invalidate() {
      this.cache.clear()
    },

    gameScore(game) {
      const catalog = this.catalog(game.genre)
      return S.computeScore(catalog, this.ratings[game.id] || {})
    },

    statusName(id) {
      const found = this.catalog(null).statuses.find((s) => s.id === id)
      return found ? found.name : id
    },

    genreName(id) {
      const found = this.catalog(null).genres.find((g) => g.id === id)
      return found ? found.name : id
    },

    navigate(hash) {
      if (location.hash === hash) this.render()
      else location.hash = hash
    },

    async refresh() {
      const [profile, games, ratings, patches] = await Promise.all([
        api.profile.get(),
        api.games.list(),
        api.ratings.all(),
        api.patches.list()
      ])
      this.profile = profile
      this.games = games
      this.ratings = ratings
      this.patches = patches
      this.invalidate()
      applyAccent(profile.accent)
      renderProfileMini()
      renderNavCount()
      this.render()
    },

    render() {
      const route = parseRoute()
      setActiveNav(route)
      const view = U.$('#view')
      if (!view) return
      view.scrollTop = 0
      if (route.name === 'overview') renderOverview(view)
      else if (route.name === 'library') renderLibrary(view)
      else if (route.name === 'game') renderDetail(view, route.id)
      else if (route.name === 'new') window.K.Editor.render(view, null)
      else if (route.name === 'edit') window.K.Editor.render(view, route.id)
      else if (route.name === 'profile') window.K.Pages.renderProfile(view)
      else if (route.name === 'patches') window.K.Pages.renderPatches(view)
      else if (route.name === 'settings') window.K.Pages.renderSettings(view)
      else renderOverview(view)
    }
  }

  window.K.app = app

  /* ---------- служебное ---------- */

  function parseRoute() {
    const raw = (location.hash || '#/overview').replace(/^#\/?/, '')
    const parts = raw.split('/').filter(Boolean)
    if (!parts.length) return { name: 'overview' }
    if (parts[0] === 'game') return { name: 'game', id: parts[1] }
    if (parts[0] === 'edit') return { name: 'edit', id: parts[1] }
    return { name: parts[0] }
  }

  function setActiveNav(route) {
    const map = { overview: '#/overview', new: '#/new', edit: '#/library', library: '#/library', game: '#/library', profile: '#/profile', patches: '#/patches', settings: '#/settings' }
    U.$$('#nav .nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === map[route.name])
    })
  }

  function applyAccent(color) {
    if (/^#[0-9a-fA-F]{6}$/.test(color || '')) {
      document.documentElement.style.setProperty('--accent', color)
    }
  }

  function renderProfileMini() {
    const el = U.$('#profile-mini')
    if (!el) return
    el.innerHTML =
      '<div class="mini-avatar">' + U.esc(app.profile.avatar || '🎮') + '</div>' +
      '<div class="grow"><div class="mini-name ellipsis">' + U.esc(app.profile.nickname || 'Игрок') + '</div>' +
      '<div class="mini-sub ellipsis">' + U.esc(app.profile.tagline || 'мой профиль') + '</div></div>'
  }

  function renderNavCount() {
    const el = U.$('#nav-count')
    if (el) el.textContent = app.games.length ? String(app.games.length) : ''
  }

  function statusChip(id) {
    const cls = id === 'done' ? 'good' : id === 'dropped' ? 'bad' : id === 'playing' || id === 'replay' ? 'accent' : ''
    return '<span class="chip ' + cls + '">' + U.esc(app.statusName(id)) + '</span>'
  }

  function pageHead(eyebrow, title, sub, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + U.esc(eyebrow) + '</div>' +
      '<h1 class="page-title">' + U.esc(title) + '</h1>' +
      (sub ? '<p class="page-sub">' + U.esc(sub) + '</p>' : '') +
      '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>'
  }

  function shell(html) {
    return '<div class="view-inner">' + html + '</div>'
  }

  function avg(values) {
    if (!values.length) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /* ---------- обзор ---------- */

  function renderOverview(view) {
    const games = app.games.slice()
    const scored = games.map((g) => ({ game: g, score: app.gameScore(g) }))
    const complete = scored.filter((s) => s.score.rated > 0)
    const average = avg(complete.map((s) => s.score.total))
    const hours = games.reduce((sum, g) => sum + (Number(g.hours) || 0), 0)
    const genreIds = new Set(games.map((g) => g.genre))
    const recent = scored
      .slice()
      .sort((a, b) => new Date(b.game.updatedAt) - new Date(a.game.updatedAt))
      .slice(0, 4)
    const top = complete.slice().sort((a, b) => b.score.total - a.score.total).slice(0, 3)

    const genreStats = {}
    for (const item of scored) {
      const key = item.game.genre
      if (!genreStats[key]) genreStats[key] = { total: 0, count: 0 }
      if (item.score.rated > 0) {
        genreStats[key].total += item.score.total
        genreStats[key].count += 1
      }
    }
    const genres = Object.entries(genreStats)
      .map(([id, v]) => ({ id, avg: v.count ? v.total / v.count : null, count: v.count }))
      .sort((a, b) => (b.count - a.count) || ((b.avg || 0) - (a.avg || 0)))
      .slice(0, 6)

    const hour = new Date().getHours()
    const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'

    let html = '<div class="view-inner">'

    html += '<div class="hero"><div>' +
      '<div class="eyebrow">' + U.esc(greeting) + ', ' + U.esc(app.profile.nickname) + '</div>' +
      '<h2>Разбор игры по критериям</h2>' +
      '<p>126 критериев в 19 категориях. Итог — до 100 баллов: 60 за главные стороны игры, 25 за дополнительные и 15 за ваши впечатления.</p>' +
      '<div style="margin-top:16px"><button class="btn primary" data-route="#/new">' + U.icon('plus', 15) + ' Оценить игру</button>' +
      '<button class="btn ghost" style="margin-left:8px" data-action="formula">Как считается балл</button></div>' +
      '</div><div class="hero-actions">' +
      (games.length ? '<div style="text-align:right"><div class="stat-value">' + (average == null ? '—' : U.formatNumber(average)) + '<small> / 100</small></div><div class="stat-label">средний балл</div></div>' : '') +
      '</div></div>'

    html += '<div class="stats">' +
      statCard(U.icon('star', 15), String(games.length), 'оценённых игр') +
      statCard('', average == null ? '—' : U.formatNumber(average), 'средний балл') +
      statCard('', String(genreIds.size), 'жанров в профиле') +
      statCard('', U.formatNumber(hours, 0), 'часов наиграно') +
      '</div>'

    html += '<div class="two-col">'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Последние оценки</div>' +
      '<div class="card-sub">То, что вы оценивали недавно</div></div>' +
      '<button class="btn sm ghost" data-route="#/library">Все оценки</button></div>'
    if (!recent.length) {
      html += emptyBlock('Пока пусто', 'Добавьте первую игру — профиль начнёт собирать статистику.', '<button class="btn primary sm" data-route="#/new">Оценить игру</button>')
    } else {
      html += '<div class="game-list">'
      for (const item of recent) {
        html += gameRow(item.game, item.score)
      }
      html += '</div>'
    }
    html += '</div>'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Из чего складывается оценка</div>' +
      '<div class="card-sub">Доля каждого уровня в итоговом балле</div></div></div>' +
      '<div class="formula-strip"><span></span><span></span><span></span></div>' +
      '<div class="formula-legend">' +
      '<span><i class="dot" style="background:var(--accent)"></i>Основные · 60</span>' +
      '<span><i class="dot" style="background:#7c8f80"></i>Дополнительные · 25</span>' +
      '<span><i class="dot" style="background:#9c8e64"></i>Личные впечатления · 15</span>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="small muted" style="line-height:1.6">Жанр влияет на важность отдельных категорий. Например, в визуальной новелле сюжет учитывается сильнее, а в автосиме — слабее.</div>' +
      '<div style="margin-top:13px"><button class="btn sm ghost" data-action="formula">Подробнее о формуле</button></div>' +
      '</div>'

    html += '</div>'

    if (genres.length) {
      html += '<div class="card pad" style="margin-top:16px"><div class="card-head"><div><div class="card-title">Жанры</div>' +
        '<div class="card-sub">Средний балл по жанрам: сравнение только с похожими играми</div></div></div>'
      for (const g of genres) {
        html += '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
          '<div style="width:190px" class="ellipsis small">' + U.esc(app.genreName(g.id)) + '</div>' +
          '<div class="bar grow"><i style="width:' + (g.avg || 0) + '%;background:' + U.scoreColor(g.avg) + '"></i></div>' +
          '<div class="mono" style="width:52px;text-align:right;font-size:12px">' + (g.avg == null ? '—' : U.formatNumber(g.avg)) + '</div>' +
          '<div class="dim tiny" style="width:60px;text-align:right">' + g.count + ' ' + U.plural(g.count, 'игра', 'игры', 'игр') + '</div>' +
          '</div>'
      }
      html += '</div>'
    }

    if (top.length) {
      html += '<div class="subhead"><h3>Мой топ</h3><div class="line"></div><span class="tiny dim">по вашим оценкам</span></div>'
      html += '<div class="game-grid">'
      for (const item of top) html += gameCard(item.game, item.score)
      html += '</div>'
    }

    html += '</div>'
    view.innerHTML = html

    U.$$('[data-action="formula"]', view).forEach((btn) => btn.addEventListener('click', openFormula))
  }

  function statCard(iconHtml, value, label) {
    return '<div class="stat">' + (iconHtml ? '<div class="stat-icon">' + iconHtml + '</div>' : '') +
      '<div class="stat-value">' + value + '</div><div class="stat-label">' + U.esc(label) + '</div></div>'
  }

  function emptyBlock(title, text, action) {
    return '<div class="empty"><h3>' + U.esc(title) + '</h3><p>' + U.esc(text) + '</p>' + (action || '') + '</div>'
  }

  function gameRow(game, score) {
    const total = score.rated ? Math.round(score.total * 10) / 10 : null
    return '<div class="game-row" data-route="#/game/' + U.attr(game.id) + '">' +
      '<div class="thumb">' + U.esc(U.initials(game.title)) + '</div>' +
      '<div class="grow"><div class="small ellipsis" style="font-weight:600">' + U.esc(game.title) + '</div>' +
      '<div class="tiny dim ellipsis">' + U.esc(app.genreName(game.genre)) + (game.year ? ' · ' + game.year : '') + ' · ' + U.esc(U.relativeDate(game.updatedAt)) + '</div></div>' +
      '<div class="score-pill" style="color:' + U.scoreColor(total) + '">' + (total == null ? '—' : U.formatNumber(total)) + '</div>' +
      '</div>'
  }

  function gameCard(game, score) {
    const total = score.rated ? Math.round(score.total * 10) / 10 : null
    const tierValues = score.tiers.map((t) => (t.points ? (t.earned / t.points) * 10 : 0))
    return '<div class="game-card" data-route="#/game/' + U.attr(game.id) + '">' +
      '<div class="game-card-top"><div style="min-width:0"><h3 class="ellipsis">' + U.esc(game.title) + '</h3>' +
      '<div class="game-meta">' + U.esc(app.genreName(game.genre)) + (game.year ? ' · ' + game.year : '') + '</div></div>' +
      '<div class="game-card-score" style="color:' + U.scoreColor(total) + '">' + (total == null ? '—' : U.formatNumber(total)) + '<small>/100</small></div></div>' +
      '<div class="game-card-bottom">' +
      '<div class="row"><span class="chip">' + U.esc(app.statusName(game.status)) + '</span>' +
      (game.favorite ? '<span class="chip warn">★ избранное</span>' : '') +
      '<span class="spacer"></span><span class="tiny dim">' + U.esc(U.relativeDate(game.updatedAt)) + '</span></div>' +
      C.miniBars(tierValues) +
      '</div></div>'
  }

  function openFormula() {
    const html =
      '<div class="small" style="line-height:1.7;color:#c9c6bf">' +
      '<p>Итог — до 100 баллов. Уровни дают разное количество баллов:</p>' +
      '<div class="formula-strip" style="margin:14px 0 8px"><span></span><span></span><span></span></div>' +
      '<div class="formula-legend" style="margin-bottom:16px">' +
      '<span><i class="dot" style="background:var(--accent)"></i>Основные — 60</span>' +
      '<span><i class="dot" style="background:#7c8f80"></i>Дополнительные — 25</span>' +
      '<span><i class="dot" style="background:#9c8e64"></i>Личные впечатления — 15</span></div>' +
      '<p><b>1. Учитывается жанр.</b> Важность категорий зависит от жанра. Например, в RPG больше внимания уделяется сюжету, а в автосимуляторе — управлению и технике. Доли трёх уровней при этом остаются прежними: 60, 25 и 15 баллов.</p>' +
      '<p style="margin-top:10px"><b>2. Оценка критерия.</b> Каждый критерий оценивается от 0 до 10. Можно поставить «н/п», если аспект неприменим (например, сетевая игра в одиночном проекте).</p>' +
      '<p style="margin-top:10px"><b>3. Считается категория.</b> Оценки критериев объединяются с учётом их веса. Затем баллы категории распределяются внутри её уровня.</p>' +
      '<p style="margin-top:10px"><b>4. Если оценка не заполнена.</b> Баллы пустых категорий распределяются между теми, где уже есть оценки. Поэтому приложение отдельно показывает процент заполнения.</p>' +
      '<p style="margin-top:10px"><b>5. Заполнение.</b> Это доля критериев, которым вы выставили оценку. Если заполнено меньше половины, итог помечается как предварительный.</p>' +
      '<div class="divider"></div>' +
      '<p class="tiny dim">Баллы каждого уровня складываются. Итог округляется до десятых.</p>' +
      '</div>'
    U.openModal({ title: 'Как считается итоговый балл', body: html, width: 640 })
  }

  /* ---------- библиотека ---------- */

  const libraryState = { search: '', genre: '', status: '', sort: 'recent' }

  function renderLibrary(view) {
    const catalog = app.catalog(null)
    const genres = catalog.genres.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const statuses = catalog.statuses

    let html = pageHead('Коллекция', 'Мои оценки', 'Все оценённые игры. Сравнивать имеет смысл только игры одного жанра.', '<button class="btn primary" data-route="#/new">' + U.icon('plus', 15) + ' Новая оценка</button>')

    html += '<div class="tools">' +
      '<label class="search">' + U.icon('search', 15) + '<input id="lib-search" type="text" placeholder="Найти игру…" value="' + U.attr(libraryState.search) + '"></label>' +
      '<select id="lib-genre" style="width:190px"><option value="">Все жанры</option>' +
      genres.map((g) => '<option value="' + U.attr(g.id) + '"' + (libraryState.genre === g.id ? ' selected' : '') + '>' + U.esc(g.name) + '</option>').join('') +
      '</select>' +
      '<select id="lib-status" style="width:150px"><option value="">Любой статус</option>' +
      statuses.map((s) => '<option value="' + U.attr(s.id) + '"' + (libraryState.status === s.id ? ' selected' : '') + '>' + U.esc(s.name) + '</option>').join('') +
      '</select>' +
      '<select id="lib-sort" style="width:170px">' +
      [['recent', 'Сначала новые'], ['score_desc', 'Балл: больше'], ['score_asc', 'Балл: меньше'], ['title', 'По названию'], ['hours', 'По часам']]
        .map(([v, l]) => '<option value="' + v + '"' + (libraryState.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select>' +
      '<span class="spacer"></span><span class="tiny dim" id="lib-count"></span>' +
      '</div>'

    html += '<div id="library-grid"></div>'
    view.innerHTML = shell(html)

    const search = U.$('#lib-search', view)
    const update = () => {
      libraryState.search = search.value
      paintLibraryGrid()
    }
    search.addEventListener('input', U.debounce(update, 120))
    U.$('#lib-genre', view).addEventListener('change', (e) => { libraryState.genre = e.target.value; paintLibraryGrid() })
    U.$('#lib-status', view).addEventListener('change', (e) => { libraryState.status = e.target.value; paintLibraryGrid() })
    U.$('#lib-sort', view).addEventListener('change', (e) => { libraryState.sort = e.target.value; paintLibraryGrid() })

    paintLibraryGrid()
  }

  function paintLibraryGrid() {
    const grid = U.$('#library-grid')
    if (!grid) return
    const query = libraryState.search.trim().toLowerCase()
    let items = app.games.map((g) => ({ game: g, score: app.gameScore(g) }))

    if (query) items = items.filter((i) => i.game.title.toLowerCase().includes(query))
    if (libraryState.genre) items = items.filter((i) => i.game.genre === libraryState.genre)
    if (libraryState.status) items = items.filter((i) => i.game.status === libraryState.status)

    const sorters = {
      recent: (a, b) => new Date(b.game.updatedAt) - new Date(a.game.updatedAt),
      score_desc: (a, b) => (b.score.rated ? b.score.total : -1) - (a.score.rated ? a.score.total : -1),
      score_asc: (a, b) => (a.score.rated ? a.score.total : 999) - (b.score.rated ? b.score.total : 999),
      title: (a, b) => a.game.title.localeCompare(b.game.title, 'ru'),
      hours: (a, b) => (Number(b.game.hours) || 0) - (Number(a.game.hours) || 0)
    }
    items.sort(sorters[libraryState.sort] || sorters.recent)

    const count = U.$('#lib-count')
    if (count) count.textContent = items.length + ' ' + U.plural(items.length, 'игра', 'игры', 'игр')

    if (!items.length) {
      grid.innerHTML = emptyBlock(app.games.length ? 'Ничего не найдено' : 'Оценок пока нет',
        app.games.length ? 'Попробуйте изменить фильтры или запрос.' : 'Первая оценка запустит вашу личную статистику.',
        app.games.length ? '' : '<button class="btn primary sm" data-route="#/new">Оценить игру</button>')
      return
    }

    grid.innerHTML = '<div class="game-grid">' + items.map((i) => gameCard(i.game, i.score)).join('') + '</div>'
  }

  /* ---------- карточка игры ---------- */

  function renderDetail(view, id) {
    const game = app.games.find((g) => g.id === id)
    if (!game) {
      view.innerHTML = shell(pageHead('Оценка', 'Игра не найдена', 'Возможно, запись была удалена.') + emptyBlock('Нет такой записи', 'Вернитесь к списку оценок.', '<button class="btn primary sm" data-route="#/library">К моим оценкам</button>'))
      return
    }

    const catalog = app.catalog(game.genre)
    const score = S.computeScore(catalog, app.ratings[game.id] || {})
    const total = score.rated ? Math.round(score.total * 10) / 10 : null
    const grade = score.grade
    const genre = catalog.genres.find((g) => g.id === game.genre)
    const multiplierNote = score.categories.filter((c) => c.multiplier !== 1).sort((a, b) => b.multiplier - a.multiplier).slice(0, 3)

    let html = '<div class="view-inner">'
    html += '<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" data-route="#/library">' + U.icon('back', 14) + ' Мои оценки</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm ghost" data-action="export-md">' + U.icon('export', 14) + ' Экспорт .md</button>' +
      '<button class="btn sm ghost" data-route="#/edit/' + U.attr(game.id) + '">' + U.icon('edit', 14) + ' Редактировать</button>' +
      '<button class="btn sm danger" data-action="delete">' + U.icon('trash', 14) + ' Удалить</button></div>'

    html += '<div class="card detail-hero">' +
      '<div class="detail-hero-main"><div class="eyebrow">' + U.esc(genre ? genre.name : game.genre) + (game.year ? ' · ' + game.year : '') + '</div>' +
      '<h1>' + U.esc(game.title) + '</h1>' +
      '<div class="meta"><span class="chip accent">' + U.esc(app.statusName(game.status)) + '</span>' +
      (game.platforms || []).slice(0, 3).map((p) => '<span class="chip">' + U.esc(p) + '</span>').join('') +
      (game.hours ? '<span class="chip">' + U.formatNumber(game.hours, 1) + ' ч</span>' : '') +
      (game.favorite ? '<span class="chip warn">★ избранное</span>' : '') +
      '<span class="chip">оценено ' + U.esc(U.formatDate(game.updatedAt)) + '</span></div>' +
      (game.verdict ? '<div class="verdict">' + U.esc(game.verdict) + '</div>' : '') +
      '</div><div class="detail-score">' + C.ring(total, { size: 132, stroke: 10, color: U.scoreColor(total), sublabel: grade ? grade.label : 'нет оценки' }) + '</div></div>'

    html += '<div class="tier-cards">' +
      score.tiers.map((t) => '<div class="card tier-card"><div class="t-name">' + U.esc(t.name) + ' · ' + t.points + '</div>' +
        '<div class="t-value">' + U.formatNumber(t.earned) + '<small> / ' + t.points + '</small></div>' +
        '<div class="bar"><i style="width:' + (t.points ? (t.earned / t.points) * 100 : 0) + '%;background:' + U.scoreColor((t.earned / t.points) * 100) + '"></i></div>' +
        '<div class="tiny dim" style="margin-top:6px">' + t.rated + ' из ' + t.applicable + ' критериев</div></div>').join('') +
      '</div>'

    const mainCats = score.categories.filter((c) => c.tier === 'main')
    const genreScores = app.games
      .filter((g) => g.genre === game.genre)
      .map((g) => ({ id: g.id, score: S.computeScore(app.catalog(g.genre), app.ratings[g.id] || {}) }))
      .filter((x) => x.score.rated > 0)
    const avgSeries = mainCats.map((mc) => {
      const values = genreScores.map((gs) => {
        const row = gs.score.categories.find((c) => c.id === mc.id)
        return row && row.score != null ? row.score : null
      }).filter((v) => v != null)
      return avg(values)
    })
    const showAvg = genreScores.length >= 2

    html += '<div class="two-col" style="align-items:start">'
    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Основные аспекты</div>' +
      '<div class="card-sub">' + (showAvg ? 'Сравнение со средним по жанру «' + U.esc(genre ? genre.name : '') + '»' : 'Оценки по основным категориям') + '</div></div></div>' +
      '<div class="radar-wrap">' + C.radar({
        axes: mainCats.map((c) => ({ label: shortLabel(c) })),
        series: [
          { values: mainCats.map((c) => c.score || 0), color: '#d8d3c9', fillOpacity: 0.18 }
        ].concat(showAvg ? [{ values: avgSeries.map((v) => v || 0), color: '#9c8e64', fillOpacity: 0.06, dots: false }] : []),
        size: 330
      }) + '</div>' +
      '<div class="radar-legend"><span><i class="dot" style="background:#d8d3c9"></i>Эта игра</span>' +
      (showAvg ? '<span><i class="dot" style="background:#9c8e64"></i>Среднее по жанру</span>' : '') + '</div>' +
      (multiplierNote.length ? '<div class="divider"></div><div class="tiny dim" style="line-height:1.6">Жанровые коэффициенты: ' +
        multiplierNote.map((c) => U.esc(shortLabel(c)) + ' ×' + U.formatNumber(c.multiplier, 2)).join(', ') + '</div>' : '') +
      '</div>'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Лучшая и худшая категории</div>' +
      '<div class="card-sub">Крайние значения среди заполненных</div></div></div>' +
      highlightLine('Лучшая категория', bestCategory(score)) +
      highlightLine('Худшая категория', worstCategory(score)) +
      '<div class="divider"></div>' +
      '<div class="small muted" style="line-height:1.65">Покрытие: <b style="color:var(--text)">' + Math.round((score.coverage || 0) * 100) + '%</b> (' + score.rated + ' из ' + score.applicable + '). ' +
      (score.coverage < 0.5 ? 'Балл черновой — заполните больше критериев.' : 'Оценка достаточно полная.') + '</div>' +
      '</div>'
    html += '</div>'

    html += '<div class="subhead"><h3>Категории</h3><div class="line"></div><span class="tiny dim">вклад в итоговый балл</span></div>'
    html += '<div class="card" style="padding:14px 16px 6px"><table class="cat-table"><thead><tr>' +
      '<th>Категория</th><th class="num">Вес</th><th class="num">Балл</th><th>Шкала</th><th class="num">Вклад</th></tr></thead><tbody>'

    for (const tier of catalog.tiers) {
      const cats = score.categories.filter((c) => c.tier === tier.id)
      if (!cats.length) continue
      html += '<tr><td colspan="5" style="padding-top:14px"><div class="eyebrow" style="margin:0">' + U.esc(tier.name) + ' · ' + tier.points + ' баллов</div></td></tr>'
      for (const cat of cats) {
        const shown = cat.score == null ? null : Math.round(cat.score * 10) / 10
        html += '<tr><td>' + U.esc(cat.name) + '</td>' +
          '<td class="num dim">' + U.formatNumber(cat.points, 1) + '</td>' +
          '<td class="num cat-score" style="color:' + (cat.score == null ? 'var(--dim)' : U.scoreColor(cat.score * 10)) + '">' + (shown == null ? '—' : U.formatNumber(shown) + '<span class="dim tiny">/10</span>') + '</td>' +
          '<td><div class="bar"><i style="width:' + ((cat.score || 0) * 10) + '%;background:' + U.scoreColor((cat.score || 0) * 10) + '"></i></div></td>' +
          '<td class="num">' + U.formatNumber(cat.earned, 1) + '</td></tr>'
      }
    }
    html += '</tbody></table></div>'

    const customFields = catalog.customFields || []
    if (game.verdict || game.pros || game.cons || game.notes || customFields.length) {
      html += '<div class="notes-grid">'
      if (game.pros) html += noteCard('Сильные стороны', game.pros, 'good')
      if (game.cons) html += noteCard('Слабые стороны', game.cons, 'bad')
      if (game.notes) html += noteCard('Заметки', game.notes, '')
      if (game.verdict) html += noteCard('Вердикт', game.verdict, '')
      for (const field of customFields) {
        const value = game.custom && game.custom[field.key]
        if (value) html += noteCard(field.label, String(value), '')
      }
      html += '</div>'
    }

    html += '</div>'
    view.innerHTML = html

    U.$('[data-action="delete"]', view).addEventListener('click', async () => {
      const ok = await U.confirmDialog({
        title: 'Удалить оценку?',
        text: 'Игра «' + game.title + '» и все выставленные критерии будут удалены без возможности отмены.',
        confirmLabel: 'Удалить'
      })
      if (!ok) return
      await api.games.remove(game.id)
      await app.refresh()
      app.navigate('#/library')
      U.toast('Оценка удалена', 'good')
    })

    U.$('[data-action="export-md"]', view).addEventListener('click', async () => {
      const md = buildMarkdown(game, catalog, score)
      const result = await api.data.saveText({
        defaultName: slugify(game.title) + '.md',
        content: md,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.ok) U.toast('Файл сохранён', 'good')
    })
  }

  const SHORT_LABELS = {
    core: 'Цикл', systems: 'Системы', level: 'Уровни', narrative: 'Сюжет',
    visual: 'Визуал', audio: 'Звук', tech: 'Техника', ux: 'Интерфейс',
    content: 'Контент', social: 'Онлайн', support: 'Поддержка', value: 'Монетизация',
    original: 'Оригинальность', engage: 'Вовлечённость', session: 'Сессии',
    emotion: 'Эмоции', memory: 'Ценность', time: 'Время', fit: 'Сложность и темп'
  }

  function shortLabel(cat) {
    if (SHORT_LABELS[cat.id]) return SHORT_LABELS[cat.id]
    const name = cat.name || ''
    const words = name.split(' ')
    const label = words.length > 2 ? words.slice(0, 2).join(' ') : name
    return label.length > 18 ? label.slice(0, 17) + '…' : label
  }

  function bestCategory(score) {
    return score.categories.filter((c) => c.score != null && c.rated > 0).sort((a, b) => b.score - a.score)[0] || null
  }

  function worstCategory(score) {
    return score.categories.filter((c) => c.score != null && c.rated > 0).sort((a, b) => a.score - b.score)[0] || null
  }

  function highlightLine(label, cat) {
    if (!cat) return '<div class="small dim">—</div>'
    return '<div style="margin-bottom:12px"><div class="tiny dim">' + U.esc(label) + '</div>' +
      '<div class="row" style="margin-top:3px"><span class="small" style="font-weight:600">' + U.esc(cat.name) + '</span>' +
      '<span class="spacer"></span><span class="mono" style="color:' + U.scoreColor(cat.score * 10) + ';font-weight:650">' + U.formatNumber(cat.score) + '</span></div>' +
      '<div class="bar thin" style="margin-top:5px"><i style="width:' + (cat.score * 10) + '%;background:' + U.scoreColor(cat.score * 10) + '"></i></div></div>'
  }

  function noteCard(title, text, kind) {
    return '<div class="card note-card ' + kind + '"><h4>' + U.esc(title) + '</h4><div class="text">' + U.esc(text) + '</div></div>'
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'game'
  }

  function buildMarkdown(game, catalog, score) {
    const total = score.rated ? Math.round(score.total * 10) / 10 : '—'
    const lines = []
    lines.push('# ' + game.title + (game.year ? ' (' + game.year + ')' : ''))
    lines.push('')
    lines.push('**Оценка: ' + total + ' / 100** · ' + (score.grade ? score.grade.letter + ' — ' + score.grade.label : 'нет оценки'))
    lines.push('')
    lines.push('Жанр: ' + (catalog.genres.find((g) => g.id === game.genre) || { name: game.genre }).name + ' · Статус: ' + app.statusName(game.status) + (game.hours ? ' · ' + game.hours + ' ч' : ''))
    lines.push('Покрытие критериев: ' + Math.round(score.coverage * 100) + '% (' + score.rated + '/' + score.applicable + ')')
    lines.push('')
    if (game.verdict) { lines.push('## Вердикт'); lines.push(''); lines.push(game.verdict); lines.push('') }
    if (game.pros) { lines.push('## Сильные стороны'); lines.push(''); U.splitLines(game.pros).forEach((p) => lines.push('- ' + p)); lines.push('') }
    if (game.cons) { lines.push('## Слабые стороны'); lines.push(''); U.splitLines(game.cons).forEach((p) => lines.push('- ' + p)); lines.push('') }
    lines.push('## Баллы по уровням')
    lines.push('')
    lines.push('| Уровень | Баллы | Из |')
    lines.push('| --- | ---: | ---: |')
    score.tiers.forEach((t) => lines.push('| ' + t.name + ' | ' + U.formatNumber(t.earned) + ' | ' + t.points + ' |'))
    lines.push('')
    lines.push('## Категории')
    lines.push('')
    lines.push('| Категория | Балл /10 | Вес | Вклад |')
    lines.push('| --- | ---: | ---: | ---: |')
    score.categories.filter((c) => c.score != null).forEach((c) => lines.push('| ' + c.name + ' | ' + U.formatNumber(c.score) + ' | ' + U.formatNumber(c.points) + ' | ' + U.formatNumber(c.earned) + ' |'))
    lines.push('')
    if (game.notes) { lines.push('## Заметки'); lines.push(''); lines.push(game.notes); lines.push('') }
    return lines.join('\n')
  }

  /* ---------- загрузка ---------- */

  async function boot() {
    try {
      const [info, base, patches, profile, games, ratings, showHints, step] = await Promise.all([
        api.info(),
        api.catalog(),
        api.patches.list(),
        api.profile.get(),
        api.games.list(),
        api.ratings.all(),
        api.meta.get('showHints', true),
        api.meta.get('step', 0.5)
      ])
      app.info = info
      app.base = base
      app.patches = patches
      app.profile = profile
      app.games = games
      app.ratings = ratings
      app.settings.showHints = showHints !== false
      app.settings.step = [0.5, 1].includes(Number(step)) ? Number(step) : 0.5
      app.booted = true

      applyAccent(profile.accent)
      renderProfileMini()
      renderNavCount()
      const version = U.$('#side-version')
      if (version) version.textContent = 'Критериум ' + info.version + ' · ' + (info.backend === 'sqlite' ? 'SQLite' : info.backend)

      if (location.hash) app.render()
      else location.hash = '#/overview'
      U.$('#boot').classList.add('hide')
      setTimeout(() => { const b = U.$('#boot'); if (b) b.remove() }, 400)
    } catch (err) {
      console.error(err)
      const bootEl = U.$('#boot')
      if (bootEl) {
        bootEl.innerHTML = '<div style="max-width:520px;padding:24px;text-align:center"><div style="color:#ffb0a3;font-weight:600;margin-bottom:8px">Не удалось запустить приложение</div><div style="font-size:12px;color:#8d97ab;line-height:1.6">' + U.esc(err && err.message ? err.message : String(err)) + '</div></div>'
      }
    }
  }

  /* ---------- глобальные события ---------- */

  document.addEventListener('click', (event) => {
    const routeEl = event.target.closest('[data-route]')
    if (routeEl) {
      event.preventDefault()
      app.navigate(routeEl.dataset.route)
      return
    }
    const winBtn = event.target.closest('[data-win]')
    if (winBtn) {
      const action = winBtn.dataset.win
      if (action === 'minimize') api.win.minimize()
      if (action === 'maximize') api.win.maximize()
      if (action === 'close') api.win.close()
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      app.navigate('#/new')
    }
    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      const editorSave = U.$('[data-editor-save]')
      if (editorSave) { event.preventDefault(); editorSave.click() }
    }
  })

  window.addEventListener('hashchange', () => {
    if (app.booted) app.render()
  })

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
