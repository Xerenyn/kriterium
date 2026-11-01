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
    draftKey: ''
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

  async function render(view, gameId) {
    const existing = gameId ? window.K.app.games.find((g) => g.id === gameId) : null
    if (gameId && !existing) {
      view.innerHTML = '<div class="view-inner">' + U.toast('Игра не найдена', 'bad') + '</div>'
      window.K.app.navigate('#/library')
      return
    }

    const baseGame = existing ? JSON.parse(JSON.stringify(existing)) : blankGame()
    const baseRatings = existing ? JSON.parse(JSON.stringify(window.K.app.ratings[existing.id] || {})) : {}

    state.game = baseGame
    state.ratings = baseRatings
    state.draftKey = draftKeyFor(existing ? existing.id : null)
    state.dirty = false
    state.activeTier = 'main'
    state.collapsed = new Set()

    const draft = loadDraft(state.draftKey)
    if (draft && draft.game) {
      const draftCount = countRated(draft.ratings)
      const baseCount = countRated(baseRatings)
      const isNewer = !existing || draft.savedAt > existing.updatedAt
      if (isNewer && (draftCount > baseCount || (draft.game.title && !baseGame.title))) {
        state.game = Object.assign(blankGame(), draft.game)
        state.ratings = draft.ratings || {}
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
    state.catalog = window.K.app.catalog(state.game.genre)

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
      '<p class="page-sub">Заполните данные об игре и выставьте оценки. Балл пересчитывается сразу, сравнение идёт внутри жанра.</p></div>' +
      '<div class="head-actions"><button class="btn ghost" data-action="cancel">Отмена</button></div></div>'

    html += '<div class="editor-layout"><div class="editor-main">'

    /* карточка игры */
    html += '<div class="card pad"><div class="card-head" style="margin-bottom:12px"><div><div class="card-title">Игра</div>' +
      '<div class="card-sub">Жанр определяет, с какими играми сравнивается оценка</div></div></div>' +
      '<div class="form-grid">' +
      field('Название', '<input type="text" data-field="title" value="' + U.attr(g.title) + '" placeholder="Например, Disco Elysium" autofocus>', 'span2') +
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
      '<div class="card-sub">Комментарии, которые не выразить баллом</div></div></div>' +
      '<div class="form-grid">' +
      field('Вердикт', '<textarea data-field="verdict" placeholder="Кому и зачем стоит играть — в двух предложениях">' + U.esc(g.verdict) + '</textarea>', 'span4') +
      field('Сильные стороны', '<textarea data-field="pros" placeholder="По одному пункту на строку">' + U.esc(g.pros) + '</textarea>', 'span2') +
      field('Слабые стороны', '<textarea data-field="cons" placeholder="По одному пункту на строку">' + U.esc(g.cons) + '</textarea>', 'span2') +
      field('Заметки', '<textarea data-field="notes" placeholder="Свободные наблюдения, спойлеры, детали">' + U.esc(g.notes) + '</textarea>', 'span4') +
      customFieldsHtml() +
      '</div></div>'

    html += '</div>'

    /* панель балла */
    html += '<aside class="score-panel"><div class="card score-card" id="score-card"></div>' +
      '<div class="card score-actions" style="padding:12px;gap:8px">' +
      '<button class="btn primary" data-editor-save>' + U.icon('save', 15) + ' Сохранить оценку</button>' +
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
          state.catalog = window.K.app.catalog(state.game.genre)
          const note = U.$('#genre-note')
          if (note) note.textContent = (state.catalog.genre && state.catalog.genre.note) || ''
          renderCriteria()
          refreshScore()
        }
        if (key === 'title') {
          const h = U.$('.page-title', view)
          if (h && state.game.id) h.textContent = state.game.title || 'Без названия'
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
    window.K.app.navigate(id ? '#/game/' + id : '#/library')
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

    try {
      const saved = await api.games.save(game, ratings)
      localStorage.removeItem(state.draftKey)
      window.K.app.ratings[saved.id] = ratings
      window.K.app.games = await api.games.list()
      window.K.app.invalidate()
      const navCount = U.$('#nav-count')
      if (navCount) navCount.textContent = window.K.app.games.length ? String(window.K.app.games.length) : ''
      state.dirty = false
      U.toast('Оценка сохранена', 'good')
      window.K.app.navigate('#/game/' + saved.id)
    } catch (err) {
      U.toast(err && err.message ? err.message : 'Не удалось сохранить', 'bad')
      state.saving = false
      if (btn) { btn.disabled = false; btn.innerHTML = U.icon('save', 15) + ' Сохранить оценку' }
    }
  }

  window.K.Editor = { render }
})()
