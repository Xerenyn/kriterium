/* Редактор оценки */
window.K = window.K || {};

(function () {
  'use strict'

  const U = window.K.util
  const S = window.K.scoring
  const C = window.K.charts
  const api = window.krit

  const state = {
    game: null,
    ratings: {},
    catalog: null,
    activeTier: 'main',
    collapsed: new Set(),
    dirty: false,
    saving: false,
    draftKey: '',
    communityGame: null
  }

  function blankGame() {
    const catalog = window.K.app.catalog(null)
    return {
      id: null,
      title: '',
      genre: catalog.genres.length ? catalog.genres[0].id : '',
      year: null,
      platforms: [],
      status: 'done',
      hours: null,
      started: '',
      finished: '',
      favorite: false,
      verdict: '',
      pros: '',
      cons: '',
      notes: '',
      custom: {}
    }
  }

  function catalogForGenre(genreId) {
    if (!state.communityGame) return window.K.app.catalog(genreId)
    const official = (window.K.app.cloudPatches || []).map((patch) => ({
      id: patch.patch_id,
      enabled: patch.is_enabled,
      operations: patch.operations
    }))
    return S.buildCatalog(window.K.app.base, official, genreId)
  }

  function countRated(ratings) {
    return Object.values(ratings || {}).filter((c) => c && (c.na || (c.v != null && Number.isFinite(Number(c.v))))).length
  }

  function draftKeyFor(id) {
    return 'kriterium.draft.' + (id || 'new')
  }

  function loadDraft(key) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || !parsed.game) return null
      return parsed
    } catch {
      return null
    }
  }

  function saveDraft() {
    if (!state.draftKey) return
    try {
      localStorage.setItem(state.draftKey, JSON.stringify({
        game: state.game,
        ratings: state.ratings,
        savedAt: new Date().toISOString()
      }))
    } catch { /* noop */ }
  }

  const scheduleDraft = U.debounce(saveDraft, 600)

  function markDirty() {
    state.dirty = true
    scheduleDraft()
  }

  async function render(view, gameId, steamAppId) {
    state.saving = false
    let communityGame = null
    let steamDetails = null
    const existing = gameId ? window.K.app.games.find((g) => g.id === gameId) : null
    if (gameId && !existing) {
      view.innerHTML = '<div class="view-inner">' + U.toast('Игра не найдена', 'bad') + '</div>'
      window.K.app.navigate('#/library')
      return
    }
    const effectiveSteamId = steamAppId || existing?.custom?._steamAppId || null
    if (effectiveSteamId) {
      const numericSteamId = Number(effectiveSteamId)
      view.innerHTML = '<div class="view-inner"><div class="card pad">Подготавливаем страницу оценки…</div></div>'
      try {
        const status = await api.cloud.status()
        if (!status.signedIn && steamAppId) {
          view.innerHTML = '<div class="view-inner"><div class="empty"><h3>Войдите, чтобы оценить игру</h3><p>Общие оценки публикуются от вашего аккаунта и показываются на странице игры.</p><button class="btn primary" data-route="#/account">Войти или создать аккаунт</button></div></div>'
          return
        }
        if (status.signedIn) {
          const [shared, details] = await Promise.all([
            api.cloud.publicGame(numericSteamId),
            api.cloud.steamDetails(numericSteamId)
          ])
          let sharedGame = shared?.game || null
          if (!sharedGame) {
            sharedGame = await api.cloud.addSteamGame(numericSteamId)
          }
          steamDetails = details
          communityGame = {
            steamAppId: numericSteamId,
            gameId: sharedGame.id,
            game: sharedGame,
            myCloudReview: (shared?.reviews || []).find((r) => r.profile_id === status.user?.id) || null
          }
        }
      } catch (err) {
        if (steamAppId) {
          view.innerHTML = '<div class="view-inner"><div class="empty"><h3>Не удалось открыть оценку</h3><p>' + U.esc(err.message || String(err)) + '</p><button class="btn" data-route="#/steam/' + numericSteamId + '">К странице игры</button></div></div>'
          return
        }
      }
    }

    const communityLocal = !existing && effectiveSteamId
      ? window.K.app.games.find((g) => Number(g.custom?._steamAppId) === Number(effectiveSteamId))
      : null
    const sourceGame = existing || communityLocal
    const baseGame = sourceGame ? JSON.parse(JSON.stringify(sourceGame)) : blankGame()
    let baseRatings = sourceGame ? JSON.parse(JSON.stringify(window.K.app.ratings[sourceGame.id] || {})) : {}

    if (communityGame) {
      baseGame.title = steamDetails.title
      const year = String(steamDetails.releaseDate || '').match(/\b(19|20)\d{2}\b/)
      baseGame.year = year ? Number(year[0]) : baseGame.year
      baseGame.platforms = steamDetails.platforms || baseGame.platforms
      baseGame.custom = Object.assign({}, baseGame.custom || {}, {
        _communityGameId: communityGame.gameId,
        _steamAppId: communityGame.steamAppId
      })
      if (communityGame.myCloudReview) {
        const rev = communityGame.myCloudReview
        if (!baseGame.verdict && rev.verdict) baseGame.verdict = rev.verdict
        if (!baseGame.pros && rev.pros) baseGame.pros = rev.pros
        if (!baseGame.cons && rev.cons) baseGame.cons = rev.cons
        if (rev.genre_id && !sourceGame) baseGame.genre = rev.genre_id
        if (!countRated(baseRatings) && rev.criterion_ratings && typeof rev.criterion_ratings === 'object') {
          baseRatings = JSON.parse(JSON.stringify(rev.criterion_ratings))
        }
      }
    }

    state.game = baseGame
    state.ratings = baseRatings
    state.communityGame = communityGame
    state.draftKey = draftKeyFor(sourceGame ? sourceGame.id : effectiveSteamId ? 'steam-' + effectiveSteamId : null)
    state.dirty = false
    state.activeTier = 'main'
    state.collapsed = new Set()

    const draft = loadDraft(state.draftKey)
    if (draft && draft.game) {
      const draftCount = countRated(draft.ratings)
      const baseCount = countRated(baseRatings)
      const hasDraftText = !!(draft.game.verdict || draft.game.pros || draft.game.cons || draft.game.notes)
      const isNewer = !sourceGame || draft.savedAt > sourceGame.updatedAt
      if (isNewer && (draftCount > baseCount || hasDraftText || (draft.game.title && !baseGame.title))) {
        const mergedCustom = Object.assign({}, baseGame.custom || {}, draft.game.custom || {})
        state.game = Object.assign(blankGame(), baseGame, draft.game, {
          title: communityGame ? steamDetails.title : (draft.game.title || baseGame.title),
          custom: mergedCustom
        })
        if (draftCount >= baseCount) state.ratings = draft.ratings || {}
        state.dirty = true
        setTimeout(() => U.toast('Восстановлен несохранённый черновик'), 500)
      }
    }

    if (!state.game.genre) {
      const catalog = window.K.app.catalog(null)
      state.game.genre = catalog.genres.length ? catalog.genres[0].id : ''
    }
    const allGenres = window.K.app.catalog(null).genres
    if (!allGenres.some((genre) => genre.id === state.game.genre)) {
      state.game.genre = allGenres.length ? allGenres[0].id : ''
    }
    state.catalog = catalogForGenre(state.game.genre)

    renderShell(view)
  }

  function renderShell(view) {
    const g = state.game
    const catalog = state.catalog
    const genres = window.K.app.catalog(null).genres.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const statuses = catalog.statuses

    let html = '<div class="view-inner">'
    html += '<div class="page-head"><div><div class="eyebrow">' + (g.id ? 'Редактирование' : 'Новая оценка') + '</div>' +
      '<h1 class="page-title">' + (g.id ? U.esc(g.title || 'Без названия') : 'Оценить игру') + '</h1>' +
      '<p class="page-sub">' + (state.communityGame
        ? 'Оценка привязана к общей странице игры. После сохранения она появится в вашем профиле и среди оценок участников.'
        : 'Заполните данные об игре и выставьте оценки. Балл пересчитывается сразу, сравнение идёт внутри жанра.') + '</p></div>' +
      '<div class="head-actions"><button class="btn ghost" data-action="cancel">Отмена</button></div></div>'

    html += '<div class="editor-layout"><div class="editor-main">'

    /* карточка игры */
    const linkedBanner = state.communityGame
      ? '<div class="row wrap" style="margin-top:6px;gap:6px"><span class="ach-pill">Привязано к карточке игры · Steam #' + state.communityGame.steamAppId + '</span>' +
        '<span class="tiny dim">Рецензия попадёт на общую страницу этой игры</span></div>'
      : '<div class="tiny dim" style="margin-top:5px">Нажмите на поле или начните писать (например, Resident Evil), чтобы выбрать карточку игры</div>'

    html += '<div class="card pad"><div class="card-head" style="margin-bottom:12px"><div><div class="card-title">Игра</div>' +
      '<div class="card-sub">Выберите игру из списка — все рецензии участников собираются на общей карточке игры</div></div></div>' +
      '<div class="form-grid">' +
      field(
        'Название',
        '<div class="title-picker-wrap">' +
          '<input type="text" data-field="title" autocomplete="off" value="' + U.attr(g.title) + '" placeholder="Нажмите для выбора из топа или начните вводить название…">' +
          '<div class="title-picker-dropdown hidden" id="title-picker-dropdown"></div>' +
        '</div>' + linkedBanner,
        'span2'
      ) +
      field('Жанр', '<select data-field="genre">' + genres.map((genre) => '<option value="' + U.attr(genre.id) + '"' + (g.genre === genre.id ? ' selected' : '') + '>' + U.esc(genre.name) + '</option>').join('') + '</select>', 'span2') +
      field('Год', '<input type="number" data-field="year" min="1950" max="2100" value="' + U.attr(g.year || '') + '" placeholder="2024">') +
      field('Статус', '<select data-field="status">' + statuses.map((s) => '<option value="' + U.attr(s.id) + '"' + (g.status === s.id ? ' selected' : '') + '>' + U.esc(s.name) + '</option>').join('') + '</select>') +
      field('Часы', '<input type="number" data-field="hours" min="0" step="0.5" value="' + U.attr(g.hours == null ? '' : g.hours) + '" placeholder="0">') +
      field('Платформы', '<input type="text" data-field="platforms" value="' + U.attr((g.platforms || []).join(', ')) + '" placeholder="PC, PS5">', 'span2') +
      field('Начал', '<input type="date" data-field="started" value="' + U.attr(g.started || '') + '">') +
      field('Закончил', '<input type="date" data-field="finished" value="' + U.attr(g.finished || '') + '">') +
      '</div>' +
      '<div class="row" style="margin-top:13px"><label class="row" style="gap:7px;cursor:pointer;font-size:12px;color:var(--muted)">' +
      '<input type="checkbox" data-field="favorite"' + (g.favorite ? ' checked' : '') + ' style="accent-color:var(--accent);width:14px;height:14px"> Избранное</label>' +
      '<span class="spacer"></span><span class="tiny dim" id="genre-note">' + U.esc((catalog.genre && catalog.genre.note) || '') + '</span></div>' +
      '</div>'

    /* вкладки уровней */
    html += '<div class="tier-tabs" id="tier-tabs">' + tierTabsHtml() + '</div>'
    html += '<div id="criteria-area"></div>'

    /* итоговый текст */
    html += '<div class="card pad" style="margin-top:14px"><div class="card-head" style="margin-bottom:12px"><div><div class="card-title">Вердикт и заметки</div>' +
      '<div class="card-sub">Орфография проверяется автоматически (слова с ошибками подчёркиваются, правый клик предлагает замену)</div></div></div>' +
      '<div class="form-grid">' +
      field('Вердикт', '<textarea data-field="verdict" spellcheck="true" lang="ru" placeholder="Кому и зачем стоит играть — в двух предложениях">' + U.esc(g.verdict) + '</textarea>', 'span4') +
      field('Сильные стороны', '<textarea data-field="pros" spellcheck="true" lang="ru" placeholder="По одному пункту на строку">' + U.esc(g.pros) + '</textarea>', 'span2') +
      field('Слабые стороны', '<textarea data-field="cons" spellcheck="true" lang="ru" placeholder="По одному пункту на строку">' + U.esc(g.cons) + '</textarea>', 'span2') +
      field('Заметки', '<textarea data-field="notes" spellcheck="true" lang="ru" placeholder="Свободные наблюдения, спойлеры, детали">' + U.esc(g.notes) + '</textarea>', 'span4') +
      customFieldsHtml() +
      '</div>' +
      '<div id="review-quality-box" style="margin-top:12px"></div>' +
      '</div>'

    html += '</div>'

    /* панель балла */
    html += '<aside class="score-panel"><div class="card score-card" id="score-card"></div>' +
      '<div class="card score-actions" style="padding:12px;gap:8px">' +
      '<button class="btn primary" data-editor-save>' + U.icon('save', 15) + (state.communityGame ? ' Сохранить и опубликовать' : ' Сохранить оценку') + '</button>' +
      '<button class="btn ghost" data-action="cancel">Отмена</button>' +
      '</div>' +
      '<div class="card formula-mini"><b>Как считается:</b> главные стороны игры дают 60 баллов, дополнительные — 25, личные впечатления — 15. Жанр влияет на важность категорий. Каждый критерий оценивается от 0 до 10; «н/п» исключает его из расчёта.</div>' +
      '</aside></div>'

    html += '</div>'
    view.innerHTML = html

    renderCriteria()
    renderScore()
    bindMeta(view)
    bindActions(view)
  }

  function field(label, control, span) {
    return '<div class="field ' + (span || '') + '"><label>' + U.esc(label) + '</label>' + control + '</div>'
  }

  function customFieldsHtml() {
    const fields = state.catalog.customFields || []
    if (!fields.length) return ''
    return fields.map((f) => {
      const value = state.game.custom && state.game.custom[f.key] != null ? state.game.custom[f.key] : ''
      let control
      if (f.type === 'textarea') control = '<textarea data-custom="' + U.attr(f.key) + '" placeholder="' + U.attr(f.placeholder) + '">' + U.esc(value) + '</textarea>'
      else if (f.type === 'select') control = '<select data-custom="' + U.attr(f.key) + '"><option value="">—</option>' + (f.options || []).map((o) => '<option' + (String(value) === String(o) ? ' selected' : '') + '>' + U.esc(o) + '</option>').join('') + '</select>'
      else control = '<input type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" data-custom="' + U.attr(f.key) + '" value="' + U.attr(value) + '" placeholder="' + U.attr(f.placeholder) + '">'
      return field(f.label, control, f.type === 'textarea' ? 'span4' : 'span2')
    }).join('')
  }

  function tierTabsHtml() {
    const tiers = state.catalog.tiers
    const score = S.computeScore(state.catalog, state.ratings)
    return tiers.map((t) => {
      const tierScore = score.tiers.find((x) => x.id === t.id)
      const pct = t.points ? Math.round((tierScore.earned / t.points) * 100) : 0
      return '<button class="tier-tab' + (state.activeTier === t.id ? ' active' : '') + '" data-tier="' + U.attr(t.id) + '">' +
        '<span>' + U.esc(t.name) + '</span>' +
        '<b style="color:' + U.scoreColor(pct) + '">' + U.formatNumber(tierScore.earned) + '</b>' +
        '<span class="pts">/ ' + t.points + '</span></button>'
    }).join('') + '<span class="spacer"></span><span class="tiny dim" id="tier-hint"></span>'
  }

  function currentTier() {
    return state.catalog.tiers.find((t) => t.id === state.activeTier) || state.catalog.tiers[0]
  }

  function renderCriteria() {
    const area = U.$('#criteria-area')
    if (!area) return
    const tier = currentTier()
    const cats = state.catalog.categories.filter((c) => c.tier === tier.id)

    const hint = U.$('#tier-hint')
    if (hint) hint.textContent = tier.tagline || ''

    let html = '<div class="cat-jump">' + cats.map((cat, index) =>
      '<button data-jump="' + U.attr(cat.id) + '">' + (index + 1) + '. ' + U.esc(shortCat(cat.name)) + '</button>'
    ).join('') + '</div>'

    cats.forEach((cat, index) => {
      const collapsed = state.collapsed.has(cat.id)
      html += '<div class="card cat-block" id="cat-' + U.attr(cat.id) + '">' +
        '<div class="cat-head" data-collapse="' + U.attr(cat.id) + '">' +
        '<div class="cat-index">' + String(index + 1).padStart(2, '0') + '</div>' +
        '<div class="cat-head-main"><div class="cat-name">' + U.esc(cat.name) + '</div>' +
        '<div class="cat-desc">' + U.esc(cat.short || '') + '</div></div>' +
        '<div class="cat-progress"><div class="bar thin"><i data-cat-bar="' + U.attr(cat.id) + '" style="width:0%"></i></div>' +
        '<div class="tiny dim" style="text-align:right;margin-top:3px" data-cat-count="' + U.attr(cat.id) + '"></div></div>' +
        '<div class="cat-points">' + U.formatNumber(cat.points, 1) + ' б.</div>' +
        '<span style="color:var(--dim);transform:rotate(' + (collapsed ? '-90' : '0') + 'deg);transition:.15s">' + U.icon('chevron', 14) + '</span>' +
        '</div>' +
        (collapsed ? '' : '<div class="cat-body">' + cat.criteria.map((crit) => criterionHtml(cat, crit)).join('') + '</div>') +
        '</div>'
    })

    area.innerHTML = html
    bindTierTabs()

    U.$$('[data-jump]', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = U.$('#cat-' + btn.dataset.jump)
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })

    U.$$('[data-collapse]', area).forEach((head) => {
      head.addEventListener('click', () => {
        const id = head.dataset.collapse
        if (state.collapsed.has(id)) state.collapsed.delete(id)
        else state.collapsed.add(id)
        renderCriteria()
      })
    })

    bindCriteria(area)
    cats.forEach((cat) => updateCategory(cat))
  }

  function bindTierTabs() {
    U.$$('[data-tier]', U.$('#tier-tabs')).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTier = btn.dataset.tier
        U.$('#tier-tabs').innerHTML = tierTabsHtml()
        bindTierTabs()
        renderCriteria()
      })
    })
  }

  function shortCat(name) {
    const words = String(name).split(' ')
    const label = words.length > 2 ? words.slice(0, 2).join(' ') : name
    return label.length > 22 ? label.slice(0, 21) + '…' : label
  }

  function criterionHtml(cat, crit) {
    const cell = state.ratings[crit.id] || {}
    const na = !!cell.na
    const value = cell.v == null ? 5 : Number(cell.v)
    const pct = na ? 0 : (value / 10) * 100
    return '<div class="crit" data-crit="' + U.attr(crit.id) + '">' +
      '<div class="crit-top"><div class="crit-info"><div class="crit-name">' + U.esc(crit.name) +
      '<span class="weight-badge" title="Относительный вес внутри категории">×' + U.formatNumber(crit.w, 2) + '</span></div>' +
      (window.K.app.settings.showHints && crit.hint ? '<div class="crit-hint">' + U.esc(crit.hint) + '</div>' : '') +
      '</div></div>' +
      '<div class="crit-control">' +
      '<input type="range" min="0" max="10" step="' + window.K.app.settings.step + '" value="' + value + '" data-range="' + U.attr(crit.id) + '" style="--p:' + pct + '%"' + (na ? ' disabled' : '') + '>' +
      '<input type="number" class="num-input" min="0" max="10" step="' + window.K.app.settings.step + '" value="' + (cell.v == null ? '' : value) + '" data-num="' + U.attr(crit.id) + '" placeholder="—"' + (na ? ' disabled' : '') + '>' +
      '<button class="na-btn' + (na ? ' active' : '') + '" data-na="' + U.attr(crit.id) + '" title="Не применимо — критерий исключается">н/п</button>' +
      '</div></div>'
  }

  function bindCriteria(area) {
    U.$$('[data-range]', area).forEach((input) => {
      input.addEventListener('input', () => {
        const id = input.dataset.range
        const value = Number(input.value)
        const cell = state.ratings[id] || {}
        cell.v = value
        cell.na = false
        state.ratings[id] = cell
        const num = U.$('[data-num="' + cssEscape(id) + '"]', area)
        if (num) num.value = value
        input.style.setProperty('--p', (value / 10) * 100 + '%')
        markDirty()
        refreshScore()
        updateCategoryForCriterion(id)
      })
    })

    U.$$('[data-num]', area).forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.dataset.num
        if (input.value === '') {
          delete state.ratings[id]
          const range = U.$('[data-range="' + cssEscape(id) + '"]', area)
          if (range) range.value = 5
          markDirty()
          refreshScore()
          updateCategoryForCriterion(id)
          return
        }
        let value = U.clamp(Number(input.value) || 0, 0, 10)
        value = Math.round(value / window.K.app.settings.step) * window.K.app.settings.step
        input.value = value
        const cell = state.ratings[id] || {}
        cell.v = value
        cell.na = false
        state.ratings[id] = cell
        const range = U.$('[data-range="' + cssEscape(id) + '"]', area)
        if (range) { range.value = value; range.style.setProperty('--p', (value / 10) * 100 + '%') }
        markDirty()
        refreshScore()
        updateCategoryForCriterion(id)
      })
    })

    U.$$('[data-na]', area).forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.na
        const cell = state.ratings[id] || {}
        cell.na = !cell.na
        if (cell.na) cell.v = null
        else if (cell.v == null) cell.v = 5
        state.ratings[id] = cell

        const row = btn.closest('.crit')
        const range = U.$('[data-range]', row)
        const num = U.$('[data-num]', row)
        btn.classList.toggle('active', cell.na)
        range.disabled = cell.na
        num.disabled = cell.na
        if (cell.na) {
          range.style.setProperty('--p', '0%')
          num.value = ''
        } else {
          range.value = cell.v
          range.style.setProperty('--p', (cell.v / 10) * 100 + '%')
          num.value = cell.v
        }
        markDirty()
        refreshScore()
        updateCategoryForCriterion(id)
      })
    })
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&')
  }

  function updateCategoryForCriterion(criterionId) {
    const found = state.catalog.categories.find((cat) => cat.criteria.some((c) => c.id === criterionId))
    if (found) updateCategory(found)
  }

  function updateCategory(cat) {
    const bar = U.$('[data-cat-bar="' + cssEscape(cat.id) + '"]')
    const count = U.$('[data-cat-count="' + cssEscape(cat.id) + '"]')
    if (!bar && !count) return
    let applicable = 0
    let rated = 0
    for (const crit of cat.criteria) {
      const cell = state.ratings[crit.id]
      if (cell && cell.na) continue
      applicable += 1
      if (cell && cell.v != null) rated += 1
    }
    if (bar) {
      const pct = applicable ? Math.round((rated / applicable) * 100) : 0
      bar.style.width = pct + '%'
      bar.style.background = pct === 100 ? '#8fae9a' : 'var(--accent)'
    }
    if (count) count.textContent = rated + '/' + applicable
    const jump = U.$('[data-jump="' + cssEscape(cat.id) + '"]')
    if (jump) jump.classList.toggle('done', applicable > 0 && rated === applicable)
  }

  function refreshScore() {
    renderScore()
    const tabs = U.$('#tier-tabs')
    if (!tabs) return
    const score = S.computeScore(state.catalog, state.ratings)
    U.$$('[data-tier]', tabs).forEach((btn) => {
      const t = score.tiers.find((x) => x.id === btn.dataset.tier)
      const b = btn.querySelector('b')
      if (t && b) {
        b.textContent = U.formatNumber(t.earned)
        b.style.color = U.scoreColor(t.points ? (t.earned / t.points) * 100 : 0)
      }
    })
  }

  function renderScore() {
    const card = U.$('#score-card')
    if (!card) return
    const score = S.computeScore(state.catalog, state.ratings)
    const total = score.rated ? Math.round(score.total * 10) / 10 : null
    const grade = score.grade
    const coverage = Math.round(score.coverage * 100)

    card.innerHTML =
      C.ring(total, { size: 148, stroke: 10, color: U.scoreColor(total), sublabel: grade ? grade.letter + ' · ' + grade.label : 'нет оценок' }) +
      '<div class="grade-name" style="margin-top:2px">' + (grade ? '<span class="grade-letter" style="color:' + grade.color + '">' + grade.letter + '</span> · ' + U.esc(grade.label) : 'Начните оценивать') + '</div>' +
      '<div class="tier-lines">' + score.tiers.map((t) => {
        const pct = t.points ? (t.earned / t.points) * 100 : 0
        return '<div class="tier-line"><div class="tier-line-top"><span>' + U.esc(t.name) + '</span><span><b>' + U.formatNumber(t.earned) + '</b> / ' + t.points + '</span></div>' +
          '<div class="bar thin"><i style="width:' + pct + '%;background:' + U.scoreColor(pct) + '"></i></div></div>'
      }).join('') + '</div>' +
      '<div class="coverage"><div class="coverage-top"><span>Заполнено</span><span>' + coverage + '% · ' + score.rated + ' из ' + score.applicable + '</span></div>' +
      '<div class="bar thin"><i style="width:' + coverage + '%;background:' + (coverage >= 80 ? '#8fae9a' : coverage >= 50 ? '#9c8e64' : '#b8886f') + '"></i></div>' +
      (score.rated === 0 ? '<div class="warn-note">Поставьте хотя бы несколько оценок — балл появится сразу. Критерии можно отмечать как «н/п».</div>'
        : coverage < 50 ? '<div class="warn-note">Покрытие ниже 50%: балл черновой. Незаполненные категории не учитываются, а их вес перераспределяется.</div>'
          : '') +
      '</div>'
    renderQualityPanel()
  }

  const SPELL_FIXES = {
    'вообщем': 'в общем',
    'вкратце': 'вкратце',
    'придти': 'прийти',
    'прийдется': 'придётся',
    'прийдеться': 'придётся',
    'ихний': 'их',
    'ихняя': 'их',
    'ихние': 'их',
    'евоный': 'его',
    'ейный': 'её',
    'черезчур': 'чересчур',
    'черес-чур': 'чересчур',
    'зделать': 'сделать',
    'зделал': 'сделал',
    'зделано': 'сделано',
    'здеся': 'здесь',
    'тута': 'тут',
    'симпотичный': 'симпатичный',
    'агенство': 'агентство',
    'будующее': 'будущее',
    'следующий': 'следующий',
    'следущий': 'следующий',
    'извените': 'извините',
    'координально': 'кардинально',
    'персонажы': 'персонажи',
    'сюжит': 'сюжет',
    'геймплэй': 'геймплей',
    'графикаа': 'графика',
    'оптимизацыя': 'оптимизация',
    'локализацыя': 'локализация',
    'анимацыя': 'анимация',
    'механника': 'механика',
    'механники': 'механики',
    'реиграбильность': 'реиграбельность',
    'атмосферненько': 'атмосферно',
    'скукотаа': 'скукота',
    'невозможноо': 'невозможно',
    'отвратительноо': 'отвратительно',
    'шикарноо': 'шикарно',
    'лучьше': 'лучше',
    'худше': 'хуже',
    'ниразу': 'ни разу',
    'потомучто': 'потому что',
    'также': 'также',
    'какбудто': 'как будто',
    'врятли': 'вряд ли',
    'наврятли': 'навряд ли'
  }

  const SMASH_RE = /(?:фыв|йцу|ячс|asd|qwe|zxc){2,}|(.)\1{4,}/i

  /*
   * Корни нецензурной лексики. Ищутся как подстрока в слове, чтобы ловить любые
   * формы: «охуенный», «заебись», «хуила», «пиздец», «бля», «мудачьё» и т.д.
   * Храним уже нормализованными (ё→е).
   */
  const PROFANITY_ROOTS_CYR = [
    'хуй', 'хуе', 'хуя', 'хую', 'хуи', 'хуу',
    'пизд', 'пзд',
    'бля',
    'еба', 'ебу', 'ебат', 'ебан', 'ебуч', 'ебл', 'ебис', 'ебош',
    'сучк', 'суча', 'сучар', 'сука', 'суки',
    'мудак', 'мудач', 'мудил', 'мудое',
    'гандон', 'гондон', 'пидор', 'пидар', 'пидр',
    'уеб', 'залуп', 'долбо',
    'хер', 'говно', 'говн', 'гавно', 'чмо', 'чмош', 'мраз'
  ]
  const PROFANITY_ROOTS_LAT = [
    'fuck', 'fck', 'shit', 'bitch', 'whore', 'cunt', 'asshole', 'wanker',
    'dickhead', 'motherf',
    'huy', 'xyu', 'pizd', 'ebat', 'eban', 'ebuch', 'blyad', 'blya',
    'mudak', 'pidor', 'suka', 'nahuy', 'nhuy'
  ]
  const PROFANITY_ROOTS = PROFANITY_ROOTS_CYR.concat(PROFANITY_ROOTS_LAT)

  // Подмены символов: «@», «0», «3», «6» вместо букв.
  const PROFANITY_LEET = { '@': 'а', '0': 'о', '3': 'е', '6': 'б', '*': 'а' }
  // Латинские буквы-двойники кириллицы (второй проход нормализации).
  const HOMOGLYPHS = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', i: 'и', k: 'к', m: 'м', t: 'т' }
  const LATIN_TO_CYR = /[aceopyxikmt]/g

  function profanityVariants(rawText) {
    const collapseRe = /(.)\1{2,}/g
    const low = String(rawText || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(collapseRe, '$1') // «хуууй» → «хуй»
    const leetLetters = low.replace(/[@036*]/g, (ch) => PROFANITY_LEET[ch] || '')
    const leetMasked = low.replace(/[@036*]/g, '')
    return [
      leetLetters,
      leetMasked,
      leetMasked.replace(LATIN_TO_CYR, (ch) => HOMOGLYPHS[ch] || ch).replace(collapseRe, '$1')
    ]
  }

  function scanProfanity(rawText) {
    const samples = new Set()
    let masked = false
    for (const variant of profanityVariants(rawText)) {
      for (const word of variant.match(/[a-zа-я]+/g) || []) {
        const root = PROFANITY_ROOTS.find((r) => word.includes(r))
        if (root) samples.add(word)
      }
      // Маскировка разделителями: «х у й», «бл-я», «е,б,а,т».
      let compact = ''
      const hadSepBefore = []
      for (let i = 0; i < variant.length; i++) {
        if (/[a-zа-я]/.test(variant[i])) {
          compact += variant[i]
          hadSepBefore.push(i > 0 && /[^a-zа-я]/.test(variant[i - 1]))
        }
      }
      for (const root of PROFANITY_ROOTS) {
        let at = compact.indexOf(root)
        while (at !== -1) {
          // Корень «склеился» из букв, между которыми в тексте стояли разделители.
          if (hadSepBefore.slice(at + 1, at + root.length).some(Boolean)) {
            masked = true
            break
          }
          at = compact.indexOf(root, at + 1)
        }
        if (masked) break
      }
      if (masked) break
    }
    return { samples: Array.from(samples), masked }
  }


  function analyzeReviewQuality(game, ratings, calculated) {
    const fields = [
      ['verdict', 'Вердикт', String(game?.verdict || '')],
      ['pros', 'Сильные стороны', String(game?.pros || '')],
      ['cons', 'Слабые стороны', String(game?.cons || '')],
      ['notes', 'Заметки', String(game?.notes || '')]
    ]
    const typos = []
    const suspicionReasons = []
    const profanitySamples = []
    let maskedProfanity = false
    let hasSmash = false

    for (const [fieldKey, fieldLabel, text] of fields) {
      if (!text.trim()) continue
      const profanity = scanProfanity(text)
      for (const sample of profanity.samples) {
        if (!profanitySamples.includes(sample)) profanitySamples.push(sample)
      }
      if (profanity.masked) maskedProfanity = true
      if (SMASH_RE.test(text)) hasSmash = true
      const trimmed = text.trim()
      if (trimmed.length > 0 && trimmed.length <= 2 && /^[а-яa-z0-9]$/i.test(trimmed)) {
        hasSmash = true
      }

      const words = text.match(/[а-яёa-z-]{3,}/gi) || []
      for (const rawWord of words) {
        const lower = rawWord.toLowerCase()
        if (SPELL_FIXES[lower] && SPELL_FIXES[lower] !== lower) {
          if (!typos.some((t) => t.word.toLowerCase() === lower && t.fieldKey === fieldKey)) {
            typos.push({ fieldKey, fieldLabel, word: rawWord, suggestion: SPELL_FIXES[lower] })
          }
        } else if (/(.)\1{3,}/i.test(lower)) {
          const fixed = rawWord.replace(/(.)\1{2,}/gi, '$1')
          if (!typos.some((t) => t.word === rawWord && t.fieldKey === fieldKey)) {
            typos.push({ fieldKey, fieldLabel, word: rawWord, suggestion: fixed })
          }
        } else if (/^[бвгджзклмнпрстфхцчшщ]{5,}$/i.test(lower)) {
          if (!typos.some((t) => t.word === rawWord && t.fieldKey === fieldKey)) {
            typos.push({ fieldKey, fieldLabel, word: rawWord, suggestion: null })
          }
        }
      }
    }

    if (profanitySamples.length) {
      const shown = profanitySamples.slice(0, 4).map((w) => '«' + w + '»').join(', ')
      suspicionReasons.push('Нецензурная лексика в тексте рецензии (' + profanitySamples.length + '): ' + shown)
    }
    if (maskedProfanity) {
      suspicionReasons.push('Похоже на замаскированную нецензурную лексику (буквы разделены пробелами/знаками или заменены)')
    }
    if (hasSmash) {
      suspicionReasons.push('Подозрение на спам / бессвязный набор символов в тексте')
    }

    const numericCells = Object.values(ratings || {}).filter((c) => c && !c.na && c.v != null && Number.isFinite(Number(c.v)))
    const count = numericCells.length
    if (count >= 6) {
      const zeros = numericCells.filter((c) => Number(c.v) === 0).length
      const tens = numericCells.filter((c) => Number(c.v) === 10).length
      if (zeros / count >= 0.85) {
        suspicionReasons.push('Подозрительные оценки: почти все критерии выставлены в 0 (ревью-бомбинг)')
      } else if (tens / count >= 0.85 && String(game?.verdict || '').trim().length < 20) {
        suspicionReasons.push('Подозрительные оценки: почти все критерии выставлены в 10 без текстового обоснования')
      }
    }

    const total = Number(calculated?.total) || 0
    const cov = Number(calculated?.coverage) || 0
    if (count > 0 && cov < 0.25 && (total >= 96 || total <= 15) && String(game?.verdict || '').trim().length < 25) {
      suspicionReasons.push('Экстремальный итоговый балл (' + U.formatNumber(total) + ') при низком покрытии критериев (' + Math.round(cov * 100) + '%)')
    }
    if (count >= 4 && total >= 90 && !String(game?.pros || '').trim() && String(game?.cons || '').trim().length > 15) {
      suspicionReasons.push('Противоречие: очень высокий балл (' + U.formatNumber(total) + '), но указаны только минусы')
    }
    if (count >= 4 && total <= 25 && !String(game?.cons || '').trim() && String(game?.pros || '').trim().length > 15) {
      suspicionReasons.push('Противоречие: очень низкий балл (' + U.formatNumber(total) + '), но указаны только плюсы')
    }

    return {
      typos,
      suspicious: suspicionReasons.length > 0,
      suspicionReasons
    }
  }

  function renderQualityPanel() {
    const box = U.$('#review-quality-box')
    if (!box || !state.game || !state.catalog) return
    const calc = S.computeScore(state.catalog, state.ratings)
    const q = analyzeReviewQuality(state.game, state.ratings, calc)

    let html = ''
    if (q.typos.length) {
      html += '<div class="spell-box">' +
        '<div class="tiny" style="font-weight:600;color:#e4c887;margin-bottom:6px">Проверка орфографии — найдены слова с возможной ошибкой:</div>' +
        '<div class="row wrap" style="gap:7px">' +
        q.typos.map((t, idx) =>
          '<span class="spell-item"><span class="tiny dim">' + U.esc(t.fieldLabel) + ':</span> ' +
          '<span class="spell-err-word">' + U.esc(t.word) + '</span>' +
          (t.suggestion ? ' → <button type="button" class="btn sm ghost" data-fix-idx="' + idx + '">Исправить на «' + U.esc(t.suggestion) + '»</button>' : '') +
          '</span>'
        ).join('') +
        '</div></div>'
    }

    if (q.suspicious) {
      html += '<div class="mod-warn-box">' +
        '<div class="tiny" style="font-weight:650;color:#e09a8f;margin-bottom:4px">⚠ Подозрительная рецензия — при сохранении будет отправлена на модерацию:</div>' +
        q.suspicionReasons.map((r) => '<div class="tiny" style="color:#d5b0aa">• ' + U.esc(r) + '</div>').join('') +
        '</div>'
    } else if (!q.typos.length && (state.game.verdict || state.game.pros || state.game.cons)) {
      html += '<div class="tiny dim">✓ Орфография и корректность оценок проверены — замечаний нет.</div>'
    }

    box.innerHTML = html
    U.$$('[data-fix-idx]', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = q.typos[Number(btn.dataset.fixIdx)]
        if (!item || !item.suggestion) return
        const current = String(state.game[item.fieldKey] || '')
        const updated = current.replace(item.word, item.suggestion)
        state.game[item.fieldKey] = updated
        const textarea = U.$('[data-field="' + item.fieldKey + '"]')
        if (textarea) textarea.value = updated
        markDirty()
        renderQualityPanel()
      })
    })
  }

  function bindMeta(view) {
    U.$$('[data-field]', view).forEach((input) => {
      const key = input.dataset.field
      const handler = () => {
        if (key === 'platforms') {
          state.game.platforms = input.value.split(',').map((s) => s.trim()).filter(Boolean)
        } else if (key === 'favorite') {
          state.game.favorite = input.checked
        } else if (key === 'year' || key === 'hours') {
          state.game[key] = input.value === '' ? null : Number(input.value)
        } else if (key === 'title') {
          state.game.title = input.value
        } else {
          state.game[key] = input.value
        }
        markDirty()
        if (key === 'genre') {
          state.catalog = catalogForGenre(state.game.genre)
          const note = U.$('#genre-note')
          if (note) note.textContent = (state.catalog.genre && state.catalog.genre.note) || ''
          renderCriteria()
          refreshScore()
        }
        if (key === 'title') {
          const h = U.$('.page-title', view)
          if (h && state.game.id) h.textContent = state.game.title || 'Без названия'
        }
        if (['verdict', 'pros', 'cons', 'notes'].includes(key)) {
          renderQualityPanel()
        }
      }
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' || input.type === 'checkbox' ? 'change' : 'input', handler)
    })

    U.$$('[data-custom]', view).forEach((input) => {
      input.addEventListener('input', () => {
        state.game.custom = state.game.custom || {}
        state.game.custom[input.dataset.custom] = input.value
        markDirty()
      })
    })

    bindTitlePicker(view)
  }

  let pickerCacheTop = null
  let pickerTimer = null

  function safePickerImg(value) {
    try {
      const url = new URL(String(value || ''))
      return url.protocol === 'https:' && /(^|\.)(steamstatic\.com|akamaihd\.net)$/.test(url.hostname.split('.').slice(-2).join('.')) ? url.href : ''
    } catch { return '' }
  }

  async function loadTopPickerItems() {
    if (pickerCacheTop && Date.now() - pickerCacheTop.ts < 60000) return pickerCacheTop.items
    const featured = await api.cloud.steamFeatured('featured').catch(() => [])
    const commMap = await api.cloud.communityBySteamIds(featured.map((x) => x.steamAppId)).catch(() => ({}))
    const items = featured.map((item) => Object.assign({}, item, { community: commMap[item.steamAppId] || null }))
    items.sort((a, b) => ((b.community?.count || 0) - (a.community?.count || 0)) || ((b.community?.average || 0) - (a.community?.average || 0)))
    pickerCacheTop = { ts: Date.now(), items }
    return items
  }

  function bindTitlePicker(view) {
    const input = U.$('[data-field="title"]', view)
    const dropdown = U.$('#title-picker-dropdown', view)
    if (!input || !dropdown) return

    const renderDropdown = (items, heading) => {
      if (!dropdown.isConnected) return
      if (!items || !items.length) {
        dropdown.innerHTML = '<div class="picker-empty">Игры не найдены — продолжайте вводить название</div>'
        dropdown.classList.remove('hidden')
        return
      }
      dropdown.innerHTML =
        '<div class="picker-head">' + U.esc(heading) + '</div>' +
        '<div class="picker-list">' +
        items.slice(0, 8).map((item) => {
          const img = safePickerImg(item.headerImage || item.image)
          const comm = item.community
          const sub = [
            Array.isArray(item.genres) && item.genres.length ? item.genres.slice(0, 2).join(', ') : '',
            item.releaseDate || '',
            'Steam #' + item.steamAppId
          ].filter(Boolean).join(' · ')
          return '<button type="button" class="picker-item" data-pick-steam="' + Number(item.steamAppId) + '">' +
            (img ? '<img src="' + U.attr(img) + '" alt="" class="picker-thumb">' : '<span class="picker-thumb placeholder">ИГРА</span>') +
            '<span class="picker-info"><b>' + U.esc(item.title) + '</b><small>' + U.esc(sub) + '</small></span>' +
            (comm?.count ? '<span class="ach-pill">★ ' + U.formatNumber(comm.average) + ' (' + comm.count + ')</span>' : '') +
            (item.metacritic?.score ? '<span class="chip good">MC ' + item.metacritic.score + '</span>' : '') +
            '<span class="picker-go">Оценить →</span>' +
          '</button>'
        }).join('') +
        '</div>'
      dropdown.classList.remove('hidden')

      U.$$('[data-pick-steam]', dropdown).forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const appId = Number(btn.dataset.pickSteam)
          dropdown.classList.add('hidden')
          if (appId > 0) {
            window.K.app.navigate('#/review/' + appId)
          }
        })
      })
    }

    const openWithQuery = async (rawQuery) => {
      const q = String(rawQuery || '').trim()
      if (q.length < 2) {
        dropdown.innerHTML = '<div class="picker-empty">Загружаем топ игр для оценки…</div>'
        dropdown.classList.remove('hidden')
        const top = await loadTopPickerItems()
        renderDropdown(top, 'Топ по оцениваниям в данный момент')
        return
      }
      dropdown.innerHTML = '<div class="picker-empty">Ищем карточки игр «' + U.esc(q) + '»…</div>'
      dropdown.classList.remove('hidden')
      try {
        const found = await api.cloud.steamSearch(q)
        const commMap = await api.cloud.communityBySteamIds(found.map((x) => x.steamAppId)).catch(() => ({}))
        const enriched = found.map((item) => Object.assign({}, item, { community: commMap[item.steamAppId] || null }))
        renderDropdown(enriched, 'Выберите карточку игры для оценки')
      } catch {
        dropdown.innerHTML = '<div class="picker-empty">Не удалось выполнить поиск</div>'
      }
    }

    input.addEventListener('focus', () => {
      const q = input.value.trim()
      if (state.communityGame && q === state.game.title) {
        openWithQuery('')
      } else {
        openWithQuery(q)
      }
    })

    input.addEventListener('click', () => {
      if (dropdown.classList.contains('hidden')) {
        const q = input.value.trim()
        openWithQuery(state.communityGame && q === state.game.title ? '' : q)
      }
    })

    input.addEventListener('input', () => {
      clearTimeout(pickerTimer)
      const q = input.value.trim()
      if (q.length < 2) {
        openWithQuery('')
      } else {
        pickerTimer = setTimeout(() => openWithQuery(q), 280)
      }
    })

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (dropdown.isConnected) dropdown.classList.add('hidden')
      }, 200)
    })
  }

  function bindActions(view) {
    U.$$('[data-action="cancel"]', view).forEach((btn) => btn.addEventListener('click', cancel))
    const save = U.$('[data-editor-save]', view)
    if (save) save.addEventListener('click', submit)
  }

  async function cancel() {
    if (state.dirty) {
      const ok = await U.confirmDialog({
        title: 'Выйти без сохранения?',
        text: 'Черновик сохранится локально, но оценка не попадёт в профиль.',
        confirmLabel: 'Выйти'
      })
      if (!ok) return
    }
    const id = state.game && state.game.id
    if (state.communityGame) window.K.app.navigate('#/steam/' + state.communityGame.steamAppId)
    else window.K.app.navigate(id ? '#/game/' + id : '#/library')
  }

  async function submit() {
    if (state.saving) return
    const game = state.game
    if (!String(game.title || '').trim()) {
      U.toast('Введите название игры', 'bad')
      const input = U.$('[data-field="title"]')
      if (input) input.focus()
      return
    }
    if (!game.genre) {
      U.toast('Выберите жанр', 'bad')
      return
    }

    state.saving = true
    const btn = U.$('[data-editor-save]')
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…' }

    const ratings = {}
    for (const [id, cell] of Object.entries(state.ratings)) {
      if (!cell) continue
      if (cell.na) ratings[id] = { na: true, v: null }
      else if (cell.v != null && Number.isFinite(Number(cell.v))) ratings[id] = { na: false, v: Number(cell.v) }
    }

    let calculated = S.computeScore(state.catalog, ratings)
    if (state.communityGame && calculated.rated === 0) {
      for (const cat of state.catalog.categories) {
        for (const crit of cat.criteria) {
          ratings[crit.id] = { na: false, v: 5 }
        }
      }
      state.ratings = JSON.parse(JSON.stringify(ratings))
      calculated = S.computeScore(state.catalog, ratings)
    }

    try {
      if (!state.communityGame) {
        const st = await api.cloud.status().catch(() => null)
        if (st?.signedIn) {
          const matches = await api.cloud.steamSearch(game.title).catch(() => [])
          const best = matches.find((m) => m.title.toLowerCase() === String(game.title).trim().toLowerCase()) || matches[0]
          if (best?.steamAppId) {
            const sharedGame = await api.cloud.addSteamGame(best.steamAppId).catch(() => null)
            if (sharedGame?.id) {
              state.communityGame = { steamAppId: best.steamAppId, gameId: sharedGame.id, game: sharedGame }
              game.title = best.title || game.title
              game.custom = Object.assign({}, game.custom || {}, {
                _communityGameId: sharedGame.id,
                _steamAppId: best.steamAppId
              })
            }
          }
        }
      }
      const saved = await api.games.save(game, ratings)
      state.game = saved
      window.K.app.ratings[saved.id] = ratings
      window.K.app.games = await api.games.list()
      window.K.app.invalidate()
      const navCount = U.$('#nav-count')
      if (navCount) navCount.textContent = window.K.app.games.length ? String(window.K.app.games.length) : ''
      if (state.communityGame) {
        const quality = analyzeReviewQuality(game, ratings, calculated)
        await api.cloud.saveReview({
          gameId: state.communityGame.gameId,
          genreId: game.genre,
          score: calculated.total,
          coverage: calculated.coverage,
          scoringVersion: window.K.app.base.coreVersion,
          officialPatchIds: (window.K.app.cloudPatches || []).filter((patch) => patch.is_enabled).map((patch) => patch.patch_id),
          reviewTitle: '',
          verdict: game.verdict,
          pros: game.pros,
          cons: game.cons,
          criterionRatings: ratings,
          moderationStatus: quality.suspicious ? 'pending' : 'approved',
          moderationReasons: quality.suspicionReasons,
          isPublic: !quality.suspicious
        })
        localStorage.removeItem(state.draftKey)
        state.dirty = false
        state.saving = false
        if (quality.suspicious) {
          U.toast('Рецензия отправлена на модерацию (' + quality.suspicionReasons[0] + ')', 'bad')
        } else {
          U.toast('Оценка опубликована на странице игры', 'good')
        }
        window.K.app.navigate('#/steam/' + state.communityGame.steamAppId)
      } else {
        localStorage.removeItem(state.draftKey)
        state.dirty = false
        state.saving = false
        U.toast('Оценка сохранена', 'good')
        window.K.app.navigate('#/game/' + saved.id)
      }
    } catch (err) {
      if (state.communityGame && game.id) {
        state.dirty = true
        saveDraft()
        U.toast('Оценка сохранена на компьютере, но не опубликована: ' + (err.message || err), 'bad')
      } else {
        U.toast(err && err.message ? err.message : 'Не удалось сохранить', 'bad')
      }
      state.saving = false
      if (btn) {
        btn.disabled = false
        btn.innerHTML = U.icon('save', 15) + (state.communityGame ? ' Повторить публикацию' : ' Сохранить оценку')
      }
    }
  }

  window.K.Editor = { render, analyzeReviewQuality, scanProfanity }
})()
