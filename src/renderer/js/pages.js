/* Страницы: профиль, патчи, настройки */
window.K = window.K || {};

(function () {
  'use strict'

  const U = window.K.util
  const S = window.K.scoring
  const api = window.krit
  const app = () => window.K.app

  const ACCENTS = ['#d8d3c9', '#a8a29a', '#93a68f', '#b0826f', '#a89a72', '#8f8f96', '#a08d86', '#7f8b8f']
  const AVATARS = ['🎮', '🕹️', '👾', '🎯', '🧠', '🦊', '🐺', '🌙', '⚡', '🔥', '🧩', '🎲']

  function shell(html) {
    return '<div class="view-inner">' + html + '</div>'
  }

  function pageHead(eyebrow, title, sub, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + U.esc(eyebrow) + '</div>' +
      '<h1 class="page-title">' + U.esc(title) + '</h1>' +
      (sub ? '<p class="page-sub">' + U.esc(sub) + '</p>' : '') +
      '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>'
  }

  function allStats() {
    const games = app().games
    const scored = games.map((g) => ({ game: g, score: app().gameScore(g) })).filter((x) => x.score.rated > 0)
    const total = scored.reduce((acc, x) => acc + x.score.total, 0)
    const hours = games.reduce((acc, g) => acc + (Number(g.hours) || 0), 0)
    const criteriaCount = Object.values(app().ratings).reduce((acc, cells) => {
      return acc + Object.values(cells || {}).filter((c) => c && c.v != null).length
    }, 0)
    const coverage = scored.length ? scored.reduce((acc, x) => acc + x.score.coverage, 0) / scored.length : 0
    const genres = {}
    for (const item of scored) {
      const id = item.game.genre
      if (!genres[id]) genres[id] = { total: 0, count: 0 }
      genres[id].total += item.score.total
      genres[id].count += 1
    }
    const genreRows = Object.entries(genres).map(([id, v]) => ({ id, avg: v.total / v.count, count: v.count })).sort((a, b) => b.avg - a.avg)
    const tiers = {}
    for (const item of scored) {
      for (const t of item.score.tiers) {
        if (!tiers[t.id]) tiers[t.id] = { total: 0, count: 0, points: t.points }
        if (t.points > 0 && t.rated > 0) {
          tiers[t.id].total += (t.earned / t.points) * 10
          tiers[t.id].count += 1
        }
      }
    }
    return {
      played: games.length,
      scored: scored.length,
      average: scored.length ? total / scored.length : null,
      hours,
      criteriaCount,
      coverage,
      genres: genreRows,
      tiers,
      scoredItems: scored
    }
  }

  function tierAveragesHtml(stats) {
    const order = ['main', 'extra', 'subjective']
    return order.map((id) => {
      const t = stats.tiers[id]
      if (!t || !t.count) return ''
      const avg = t.total / t.count
      return '<div style="margin-bottom:12px"><div class="row" style="margin-bottom:4px"><span class="tiny muted">' + U.esc(tierName(id)) + '</span>' +
        '<span class="spacer"></span><span class="tiny mono" style="color:' + U.scoreColor(avg * 10) + '">' + U.formatNumber(avg) + ' / 10</span></div>' +
        '<div class="bar thin"><i style="width:' + avg * 10 + '%;background:' + U.scoreColor(avg * 10) + '"></i></div></div>'
    }).join('')
  }

  function tierName(id) {
    return id === 'main' ? 'Основные' : id === 'extra' ? 'Дополнительные' : 'Личный опыт'
  }

  /* ---------- профиль ---------- */

  function renderProfile(view) {
    const stats = allStats()
    const profile = app().profile
    const bands = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 }
    for (const item of stats.scoredItems) {
      if (item.score.grade) bands[item.score.grade.letter] = (bands[item.score.grade.letter] || 0) + 1
    }

    let html = pageHead('Аккаунт', 'Мой профиль', 'Профиль и все оценки хранятся только на этом компьютере.',
      '<button class="btn ghost" data-action="edit-profile">' + U.icon('edit', 14) + ' Изменить</button>' +
      '<button class="btn primary" data-route="#/new">' + U.icon('plus', 14) + ' Оценить игру</button>')

    html += '<div class="card profile-hero"><div class="avatar-big">' + U.esc(profile.avatar || '🎮') + '</div>' +
      '<div class="grow"><h2>' + U.esc(profile.nickname || 'Игрок') + '</h2>' +
      '<div class="tagline">' + U.esc(profile.tagline || 'Без описания') + '</div>' +
      '<div class="row" style="margin-top:9px"><span class="chip accent">локальный аккаунт</span>' +
      '<span class="chip">с ' + U.esc(U.formatDate(profile.createdAt)) + '</span>' +
      '<span class="chip">' + stats.played + ' ' + U.plural(stats.played, 'игра', 'игры', 'игр') + '</span></div></div>' +
      '<div style="text-align:right">' + (stats.average == null ? '<div class="stat-value">—</div>' : '<div class="stat-value" style="color:' + U.scoreColor(stats.average) + '">' + U.formatNumber(stats.average) + '<small>/100</small></div>') +
      '<div class="stat-label">средний балл</div></div></div>'

    html += '<div class="stats">' +
      '<div class="stat"><div class="stat-value">' + stats.played + '</div><div class="stat-label">игр в профиле</div></div>' +
      '<div class="stat"><div class="stat-value">' + stats.criteriaCount + '</div><div class="stat-label">выставленных критериев</div></div>' +
      '<div class="stat"><div class="stat-value">' + Math.round(stats.coverage * 100) + '<small>%</small></div><div class="stat-label">среднее покрытие</div></div>' +
      '<div class="stat"><div class="stat-value">' + U.formatNumber(stats.hours, 0) + '</div><div class="stat-label">часов учтено</div></div>' +
      '</div>'

    html += '<div class="two-col">'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Баллы по уровням</div>' +
      '<div class="card-sub">Средний результат по всем оценкам (из 10)</div></div></div>' +
      (Object.keys(stats.tiers).length ? tierAveragesHtml(stats) : '<div class="small dim">Пока нет оценок.</div>') +
      '<div class="divider"></div><div class="row wrap" style="gap:6px">' +
      Object.entries(bands).filter(([_, n]) => n > 0).map(([letter, n]) => '<span class="chip">' + letter + ' · ' + n + '</span>').join('') +
      '</div></div>'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Жанры</div>' +
      '<div class="card-sub">Средний балл внутри жанра</div></div></div>'
    if (!stats.genres.length) {
      html += '<div class="small dim">Оцените первую игру, чтобы увидеть жанровую статистику.</div>'
    } else {
      html += '<table class="genre-table"><thead><tr><th>Жанр</th><th class="num">Игр</th><th class="num">Средний</th></tr></thead><tbody>'
      for (const g of stats.genres) {
        html += '<tr><td>' + U.esc(app().genreName(g.id)) + '</td><td class="num dim">' + g.count + '</td>' +
          '<td class="num" style="color:' + U.scoreColor(g.avg) + ';font-weight:600">' + U.formatNumber(g.avg) + '</td></tr>'
      }
      html += '</tbody></table>'
    }
    html += '</div></div>'

    html += '<div class="subhead"><h3>Данные</h3><div class="line"></div></div>'
    html += '<div class="card pad"><div class="row wrap" style="gap:8px">' +
      '<button class="btn" data-action="export-json">' + U.icon('export', 14) + ' Экспорт профиля (.json)</button>' +
      '<button class="btn" data-action="export-csv">' + U.icon('export', 14) + ' Таблица оценок (.csv)</button>' +
      '<button class="btn" data-action="import-json">' + U.icon('import', 14) + ' Импорт профиля</button>' +
      '<span class="spacer"></span><button class="btn danger" data-action="reset">Сбросить всё</button>' +
      '</div><div class="tiny dim" style="margin-top:10px">Экспорт включает профиль, игры, все оценки и установленные патчи. Импорт объединяет данные по id записей.</div></div>'

    view.innerHTML = shell(html)

    U.$('[data-action="edit-profile"]', view).addEventListener('click', openProfileEditor)
    U.$('[data-action="export-json"]', view).addEventListener('click', exportJson)
    U.$('[data-action="export-csv"]', view).addEventListener('click', exportCsv)
    U.$('[data-action="import-json"]', view).addEventListener('click', importJson)
    U.$('[data-action="reset"]', view).addEventListener('click', resetAll)
  }

  function openProfileEditor() {
    const profile = app().profile
    const body =
      '<div class="form-grid">' +
      '<div class="field span2"><label>Никнейм</label><input type="text" id="pf-name" maxlength="60" value="' + U.attr(profile.nickname) + '"></div>' +
      '<div class="field span2"><label>Строка о себе</label><input type="text" id="pf-tag" maxlength="120" value="' + U.attr(profile.tagline) + '"></div>' +
      '<div class="field span4"><label>Аватар</label><div class="row wrap" id="pf-avatars" style="gap:6px">' +
      AVATARS.map((a) => '<button type="button" class="btn icon" data-avatar="' + a + '" style="font-size:17px' + (a === profile.avatar ? ';border-color:var(--accent);background:var(--accent-soft)' : '') + '">' + a + '</button>').join('') +
      '<input type="text" id="pf-avatar" maxlength="4" value="' + U.attr(profile.avatar) + '" style="width:70px;text-align:center">' +
      '</div></div>' +
      '<div class="field span4"><label>Акцентный цвет</label><div class="swatches" id="pf-colors">' +
      ACCENTS.map((c) => '<button type="button" class="swatch' + (c.toLowerCase() === String(profile.accent).toLowerCase() ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>').join('') +
      '</div></div></div>'

    const modal = U.openModal({
      title: 'Профиль',
      body,
      width: 560,
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Сохранить</button>',
      onMount({ root, close }) {
        let avatar = profile.avatar
        let accent = profile.accent

        U.$$('[data-avatar]', root).forEach((btn) => btn.addEventListener('click', () => {
          avatar = btn.dataset.avatar
          U.$('#pf-avatar', root).value = avatar
          U.$$('[data-avatar]', root).forEach((b) => b.style.borderColor = '')
          btn.style.borderColor = 'var(--accent)'
          btn.style.background = 'var(--accent-soft)'
        }))
        U.$$('[data-color]', root).forEach((btn) => btn.addEventListener('click', () => {
          accent = btn.dataset.color
          U.$$('[data-color]', root).forEach((b) => b.classList.remove('active'))
          btn.classList.add('active')
        }))
        U.$('#pf-avatar', root).addEventListener('input', (e) => { avatar = e.target.value })

        U.$('[data-cancel]', root).addEventListener('click', close)
        U.$('[data-save]', root).addEventListener('click', async () => {
          const nickname = U.$('#pf-name', root).value.trim()
          if (!nickname) { U.toast('Никнейм не может быть пустым', 'bad'); return }
          await api.profile.save({
            nickname,
            tagline: U.$('#pf-tag', root).value.trim(),
            avatar: avatar || '🎮',
            accent
          })
          close()
          await app().refresh()
          U.toast('Профиль обновлён', 'good')
        })
      }
    })
    return modal
  }

  async function exportJson() {
    const result = await api.data.export()
    if (result.ok) U.toast('Резервная копия сохранена', 'good')
  }

  async function importJson() {
    try {
      const result = await api.data.import()
      if (!result.ok) return
      await app().refresh()
      U.toast('Импортировано игр: ' + result.games + ', патчей: ' + result.patches, 'good')
    } catch (err) {
      U.toast(err && err.message ? err.message : 'Ошибка импорта', 'bad')
    }
  }

  async function exportCsv() {
    const rows = [['Название', 'Жанр', 'Год', 'Статус', 'Часы', 'Балл', 'Покрытие', 'Вердикт']]
    for (const game of app().games) {
      const score = app().gameScore(game)
      rows.push([
        game.title,
        app().genreName(game.genre),
        game.year || '',
        app().statusName(game.status),
        game.hours == null ? '' : game.hours,
        score.rated ? (Math.round(score.total * 10) / 10) : '',
        Math.round(score.coverage * 100) + '%',
        (game.verdict || '').replace(/\s+/g, ' ')
      ])
    }
    const csv = '\ufeff' + rows.map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const result = await api.data.saveText({
      defaultName: 'kriterium-ratings.csv',
      content: csv,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.ok) U.toast('Таблица сохранена', 'good')
  }

  async function resetAll() {
    const ok = await U.confirmDialog({
      title: 'Удалить все данные?',
      text: 'Будут удалены профиль, все игры, оценки и патчи. Резервную копию можно сделать заранее. Действие необратимо.',
      confirmLabel: 'Удалить всё'
    })
    if (!ok) return
    await api.data.reset()
    await app().refresh()
    app().navigate('#/overview')
    U.toast('Данные сброшены', 'good')
  }

  /* ---------- патчи ---------- */

  let examplePatch = null

  function renderPatches(view) {
    const patches = app().patches.slice().sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))
    const base = app().base
    const criteriaCount = base.categories.reduce((n, c) => n + c.criteria.length, 0)

    let html = pageHead('Дополнения', 'Патчи', 'Патчи добавляют критерии, жанры и поля. Основной набор остаётся неизменным, дополнения можно отключить.',
      '<button class="btn ghost" data-action="paste-patch">' + U.icon('code', 14) + ' Вставить JSON</button>' +
      '<button class="btn primary" data-action="import-patch">' + U.icon('plus', 14) + ' Загрузить патч</button>')

    html += '<div class="card pad" style="margin-bottom:18px"><div class="row wrap" style="gap:18px">' +
      '<div><div class="stat-value">' + criteriaCount + '</div><div class="stat-label">критериев в ядре</div></div>' +
      '<div><div class="stat-value">' + (base.categories.length) + '</div><div class="stat-label">категорий</div></div>' +
      '<div><div class="stat-value">' + (base.genres.length) + '</div><div class="stat-label">жанров</div></div>' +
      '<div><div class="stat-value">' + patches.filter((p) => p.enabled).length + '</div><div class="stat-label">активных патчей</div></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn sm ghost" data-action="example">Скачать пример патча</button></div>' +
      '<div class="divider"></div>' +
      '<div class="small muted" style="line-height:1.65">Отключение патча сразу меняет веса и итог, но не удаляет выставленные оценки. Если вернуть критерий с тем же id, баллы восстановятся.</div>' +
      '</div>'

    html += '<div class="subhead" style="margin-top:8px"><h3>Установленные патчи</h3><div class="line"></div><span class="tiny dim">' + patches.length + '</span></div>'

    if (!patches.length) {
      html += '<div class="empty"><h3>Патчей пока нет</h3><p>Добавьте собственный критерий, жанр или поле — приложение сохранит это как патч «Мои дополнения».</p>' +
        '<button class="btn primary sm" data-action="new-criterion">Добавить критерий</button></div>'
    } else {
      for (const patch of patches) {
        html += patchCard(patch)
      }
    }

    html += '<div class="subhead"><h3>Свои дополнения</h3><div class="line"></div></div>'
    html += '<div class="card pad"><div class="row wrap" style="gap:8px">' +
      '<button class="btn" data-action="new-criterion">' + U.icon('plus', 14) + ' Новый критерий</button>' +
      '<button class="btn" data-action="new-genre">' + U.icon('plus', 14) + ' Новый жанр</button>' +
      '<button class="btn" data-action="new-field">' + U.icon('plus', 14) + ' Новое поле</button>' +
      '</div><div class="tiny dim" style="margin-top:10px">Всё созданное попадает в патч <b>user.extensions</b> и применяется сразу.</div></div>'

    html += '<div class="subhead"><h3>Как устроен патч</h3><div class="line"></div></div>'
    html += '<div class="card pad"><div class="small muted" style="line-height:1.65;margin-bottom:12px">JSON-объект с массивом операций. Поддерживаются: addCriterion, updateCriterion, removeCriterion, addCategory, updateCategory, removeCategory, addGenre, updateGenre, addField, addStatus.</div>' +
      '<pre class="code">' + U.esc(JSON.stringify(examplePatchData(), null, 2)) + '</pre></div>'

    view.innerHTML = shell(html)
    renderOfficialPatchPanel(view)

    U.$$('[data-toggle-patch]', view).forEach((btn) => btn.addEventListener('click', async () => {
      await api.patches.toggle(btn.dataset.togglePatch)
      await app().refresh()
    }))
    U.$$('[data-view-patch]', view).forEach((btn) => btn.addEventListener('click', () => {
      const patch = app().patches.find((p) => p.id === btn.dataset.viewPatch)
      if (!patch) return
      U.openModal({ title: patch.name, body: '<pre class="code">' + U.esc(JSON.stringify(stripPatch(patch), null, 2)) + '</pre>', width: 700 })
    }))
    U.$$('[data-delete-patch]', view).forEach((btn) => btn.addEventListener('click', async () => {
      const patch = app().patches.find((p) => p.id === btn.dataset.deletePatch)
      if (!patch) return
      const ok = await U.confirmDialog({ title: 'Удалить патч?', text: '«' + patch.name + '» будет удалён. Оценки по его критериям сохранятся в базе и вернутся, если критерий добавить снова.', confirmLabel: 'Удалить' })
      if (!ok) return
      await api.patches.remove(patch.id)
      await app().refresh()
      U.toast('Патч удалён', 'good')
    }))

    U.$('[data-action="import-patch"]', view).addEventListener('click', importPatchFile)
    U.$('[data-action="paste-patch"]', view).addEventListener('click', openPastePatch)
    U.$('[data-action="example"]', view).addEventListener('click', downloadExample)
    U.$('[data-action="new-criterion"]', view).addEventListener('click', openNewCriterion)
    U.$('[data-action="new-genre"]', view).addEventListener('click', openNewGenre)
    U.$('[data-action="new-field"]', view).addEventListener('click', openNewField)
  }

  function stripPatch(patch) {
    return {
      id: patch.id,
      name: patch.name,
      version: patch.version,
      author: patch.author,
      description: patch.description,
      operations: patch.operations || []
    }
  }

  async function renderOfficialPatchPanel(view) {
    const inner = U.$('.view-inner', view)
    if (!inner) return
    const host = document.createElement('div')
    host.id = 'official-patch-panel'
    const pageHeadEl = U.$('.page-head', inner)
    if (pageHeadEl) pageHeadEl.insertAdjacentElement('afterend', host)
    try {
      const status = await api.cloud.status()
      if (location.hash !== '#/patches' || !host.isConnected) return
      let patches = []
      if (status.configured) patches = await api.cloud.listAppPatches()
      if (location.hash !== '#/patches' || !host.isConnected) return
      const isDeveloper = status.signedIn ? await api.cloud.isDeveloper().catch(() => false) : false
      if (location.hash !== '#/patches' || !host.isConnected) return

      let html = '<div class="subhead" style="margin-top:8px"><h3>Официальные патчи</h3><div class="line"></div>' +
        '<span class="chip">' + (isDeveloper ? 'права разработчика' : 'общие для всех') + '</span></div>'
      if (!status.configured) {
        html += '<div class="card pad"><p class="small muted">Подключите общую базу, чтобы загружать официальные патчи. Личные дополнения работают отдельно и видны только на этом компьютере.</p>' +
          '<button class="btn sm" data-route="#/account" style="margin-top:10px">Настроить общий аккаунт</button></div>'
      } else {
        if (isDeveloper) {
          html += '<div class="card pad" style="margin-bottom:12px"><div class="card-head"><div><div class="card-title">Опубликовать изменение для всех</div>' +
            '<div class="card-sub">Только аккаунт разработчика может добавлять, отключать и удалять официальные патчи.</div></div></div>' +
            '<textarea id="official-patch-json" style="min-height:190px;font-family:Consolas,monospace;font-size:11px" placeholder="Вставьте JSON патча с полями id, name и operations"></textarea>' +
            '<button class="btn primary" id="official-patch-publish" style="margin-top:10px">Опубликовать патч</button></div>'
        }
        if (!patches.length) {
          html += '<div class="empty"><h3>Официальных патчей пока нет</h3><p>' + (isDeveloper ? 'Опубликуйте первый патч выше. Он появится у всех участников.' : 'Здесь появятся изменения, опубликованные разработчиком.') + '</p></div>'
        } else {
          html += patches.map((patch) => officialPatchCard(patch, isDeveloper)).join('')
        }
      }
      host.innerHTML = html

      if (isDeveloper) {
        U.$('#official-patch-publish', host)?.addEventListener('click', async (event) => {
          const button = event.currentTarget
          let patch
          try { patch = JSON.parse(U.$('#official-patch-json', host).value) } catch { U.toast('Проверьте JSON патча', 'bad'); return }
          const previous = app().cloudPatches.filter((item) => item.patch_id !== patch.id && item.is_enabled)
          const validationBase = S.buildCatalog(app().base, previous.map((item) => ({ operations: item.operations })), null)
          const validation = S.validatePatch(patch, validationBase)
          if (!validation.ok) {
            U.toast(validation.errors[0] || 'Патч не прошёл проверку', 'bad')
            return
          }
          button.disabled = true
          button.textContent = 'Публикуем…'
          try {
            await api.cloud.publishAppPatch(patch)
            await app().reloadCloudPatches(true)
            U.toast('Официальный патч опубликован для всех', 'good')
          } catch (err) {
            U.toast(err.message || 'Не удалось опубликовать патч', 'bad')
            button.disabled = false
            button.textContent = 'Опубликовать патч'
          }
        })

        U.$$('[data-toggle-official]', host).forEach((button) => button.addEventListener('click', async () => {
          const patch = patches.find((item) => item.patch_id === button.dataset.toggleOfficial)
          if (!patch) return
          try {
            await api.cloud.toggleAppPatch(patch.patch_id, !patch.is_enabled)
            await app().reloadCloudPatches(true)
            U.toast(patch.is_enabled ? 'Патч отключён у всех участников' : 'Патч включён для всех', 'good')
          } catch (err) { U.toast(err.message || 'Не удалось изменить патч', 'bad') }
        }))
        U.$$('[data-delete-official]', host).forEach((button) => button.addEventListener('click', async () => {
          const patch = patches.find((item) => item.patch_id === button.dataset.deleteOfficial)
          if (!patch) return
          const ok = await U.confirmDialog({ title: 'Удалить общий патч?', text: '«' + patch.name + '» перестанет применяться у всех участников. Личные оценки при этом сохранятся.', confirmLabel: 'Удалить' })
          if (!ok) return
          try {
            await api.cloud.deleteAppPatch(patch.patch_id)
            await app().reloadCloudPatches(true)
            U.toast('Официальный патч удалён', 'good')
          } catch (err) { U.toast(err.message || 'Не удалось удалить патч', 'bad') }
        }))
      }
    } catch (err) {
      if (host.isConnected && location.hash === '#/patches') {
        host.innerHTML = '<div class="subhead"><h3>Официальные патчи</h3><div class="line"></div></div><div class="card pad small muted">Не удалось загрузить общие патчи: ' + U.esc(err.message || String(err)) + '</div>'
      }
    }
  }

  function officialPatchCard(patch, isDeveloper) {
    return '<div class="card patch-card"><div class="patch-top"><div class="grow"><div class="patch-name">' + U.esc(patch.name) +
      ' <span class="tiny dim">v' + U.esc(patch.version || '1.0.0') + '</span> ' +
      (patch.is_enabled ? '<span class="chip good">включён</span>' : '<span class="chip">отключён</span>') + '</div>' +
      '<div class="tiny dim" style="margin-top:4px">общий патч · ' + U.esc(patch.patch_id) + '</div>' +
      (patch.description ? '<div class="small muted" style="margin-top:6px">' + U.esc(patch.description) + '</div>' : '') +
      '<div class="patch-ops">' + S.patchSummary({ operations: patch.operations }).map((op) => '<span class="op-chip">' + U.esc(op.label) + ' ' + op.count + '</span>').join('') + '</div></div>' +
      (isDeveloper ? '<div class="patch-actions"><button class="switch' + (patch.is_enabled ? ' on' : '') + '" data-toggle-official="' + U.attr(patch.patch_id) + '" title="Включить / выключить у всех"></button>' +
        '<button class="btn ghost icon" data-delete-official="' + U.attr(patch.patch_id) + '" title="Удалить у всех">' + U.icon('trash', 14) + '</button></div>' : '') +
      '</div></div>'
  }

  function patchCard(patch) {
    const ops = S.patchSummary(patch)
    return '<div class="card patch-card"><div class="patch-top">' +
      '<div class="grow"><div class="patch-name">' + U.esc(patch.name) + ' <span class="tiny dim">v' + U.esc(patch.version || '1.0.0') + '</span></div>' +
      '<div class="tiny dim" style="margin-top:2px">' + U.esc(patch.id) + (patch.author ? ' · ' + U.esc(patch.author) : '') + ' · ' + U.esc(U.formatDate(patch.appliedAt)) + '</div>' +
      (patch.description ? '<div class="small muted" style="margin-top:6px">' + U.esc(patch.description) + '</div>' : '') +
      '<div class="patch-ops">' + ops.map((o) => '<span class="op-chip">' + U.esc(o.label) + ' ' + o.count + '</span>').join('') + '</div></div>' +
      '<div class="patch-actions">' +
      '<button class="switch' + (patch.enabled ? ' on' : '') + '" data-toggle-patch="' + U.attr(patch.id) + '" title="Включить / выключить"></button>' +
      '<button class="btn ghost icon" data-view-patch="' + U.attr(patch.id) + '" title="Показать JSON">' + U.icon('code', 14) + '</button>' +
      '<button class="btn ghost icon" data-delete-patch="' + U.attr(patch.id) + '" title="Удалить">' + U.icon('trash', 14) + '</button>' +
      '</div></div></div>'
  }

  function examplePatchData() {
    return {
      id: 'example.atmosphere',
      name: 'Пример: атмосфера',
      version: '1.0.0',
      author: 'Вы',
      description: 'Добавляет два критерия и текстовое поле. Можно менять под себя.',
      operations: [
        { op: 'addCriterion', categoryId: 'audio', criterion: { id: 'custom.audio.afterglow', name: 'Звуковой след', w: 1, hint: 'Вспоминается ли музыка или звук игры после выхода из неё.' } },
        { op: 'addCriterion', categoryId: 'level', criterion: { id: 'custom.level.detail', name: 'Плотность деталей', w: 0.8, hint: 'Насколько среда населена интерактивными и просто живыми деталями.' } },
        { op: 'addField', field: { key: 'atmosphere', label: 'Атмосфера в одном слове', type: 'text', placeholder: 'например, «мокрая осень»' } }
      ]
    }
  }

  async function downloadExample() {
    const result = await api.data.saveText({
      defaultName: 'example-patch.json',
      content: JSON.stringify(examplePatchData(), null, 2),
      filters: [{ name: 'Патч', extensions: ['json'] }]
    })
    if (result.ok) U.toast('Пример сохранён', 'good')
  }

  function validateInContext(patch) {
    const errors = []
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['Патч должен быть JSON-объектом']
    if (!patch.id || !/^[a-zA-Z0-9._-]{3,80}$/.test(patch.id)) errors.push('id патча: латиница, цифры, точка, дефис, подчёркивание (3–80)')
    if (!Array.isArray(patch.operations) || !patch.operations.length) errors.push('Нужен непустой массив operations')
    if (errors.length) return errors
    const ctx = S.buildCatalog(app().base, app().patches.filter((p) => p.id !== patch.id), null)
    const test = S.clone(ctx)
    const opErrors = S.applyOps(test, patch)
    return opErrors
  }

  async function installPatch(patch, options) {
    const errors = validateInContext(patch)
    if (errors.length) {
      U.openModal({
        title: 'Патч не применён',
        body: '<div class="small" style="color:#ffb0a3;line-height:1.7">' + errors.map((e) => '• ' + U.esc(e)).join('<br>') + '</div>',
        width: 560
      })
      return false
    }
    const existing = app().patches.find((p) => p.id === patch.id)
    if (existing && !(options && options.replace)) {
      const ok = await U.confirmDialog({
        title: 'Патч уже установлен',
        text: 'Патч с id «' + patch.id + '» уже есть. Заменить его новой версией?',
        confirmLabel: 'Заменить'
      })
      if (!ok) return false
    }
    await api.patches.save(patch)
    await app().refresh()
    U.toast('Патч установлен: ' + patch.name, 'good')
    return true
  }

  async function importPatchFile() {
    try {
      const file = await api.patchFile()
      if (!file.ok) return
      const patch = JSON.parse(file.text)
      await installPatch(patch)
    } catch (err) {
      U.toast('Не удалось прочитать патч: ' + (err.message || err), 'bad')
    }
  }

  function openPastePatch() {
    U.openModal({
      title: 'Вставить патч',
      body: '<div class="small dim" style="margin-bottom:8px">Вставьте JSON патча целиком.</div>' +
        '<textarea id="patch-json" style="min-height:280px;font-family:\'Cascadia Code\',Consolas,monospace;font-size:11px" placeholder="{ &quot;id&quot;: &quot;my.patch&quot;, &quot;operations&quot;: [ ... ] }"></textarea>',
      width: 660,
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-apply>Применить</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root).addEventListener('click', close)
        U.$('[data-apply]', root).addEventListener('click', async () => {
          const raw = U.$('#patch-json', root).value.trim()
          if (!raw) return
          let patch
          try { patch = JSON.parse(raw) } catch (err) { U.toast('Некорректный JSON', 'bad'); return }
          const ok = await installPatch(patch)
          if (ok) close()
        })
      }
    })
  }

  function userPatch() {
    const existing = app().patches.find((p) => p.id === 'user.extensions')
    if (existing) return JSON.parse(JSON.stringify(stripPatch(existing)))
    return {
      id: 'user.extensions',
      name: 'Мои дополнения',
      version: '1.0.0',
      author: '',
      description: 'Критерии, жанры и поля, добавленные вручную',
      operations: []
    }
  }

  async function pushUserOp(op) {
    const patch = userPatch()
    patch.operations.push(op)
    await api.patches.save(patch)
    await app().refresh()
  }

  function openNewCriterion() {
    const catalog = app().catalog(null)
    const options = catalog.tiers.map((tier) => {
      const cats = catalog.categories.filter((c) => c.tier === tier.id)
      return '<optgroup label="' + U.attr(tier.name) + '">' + cats.map((c) => '<option value="' + U.attr(c.id) + '">' + U.esc(c.name) + '</option>').join('') + '</optgroup>'
    }).join('')

    U.openModal({
      title: 'Новый критерий',
      width: 620,
      body:
        '<div class="form-grid">' +
        '<div class="field span2"><label>Категория</label><select id="nc-cat">' + options + '</select></div>' +
        '<div class="field"><label>Вес</label><input type="number" id="nc-w" value="1" min="0.1" max="10" step="0.1"></div>' +
        '<div class="field span4"><label>Название</label><input type="text" id="nc-name" placeholder="Например, качество внутриигровой рекламы"></div>' +
        '<div class="field span4"><label>Что оценивать</label><textarea id="nc-hint" placeholder="Одно-два предложения: на что смотреть и что считать хорошим результатом"></textarea></div>' +
        '</div>' +
        '<div class="tiny dim" style="margin-top:10px">Вес относительный: он работает внутри выбранной категории. Итоговые 60/25/15 не меняются.</div>',
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Добавить</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root).addEventListener('click', close)
        U.$('[data-save]', root).addEventListener('click', async () => {
          const name = U.$('#nc-name', root).value.trim()
          if (!name) { U.toast('Введите название критерия', 'bad'); return }
          const id = 'custom.' + U.uid('c').replace('c_', '')
          await pushUserOp({
            op: 'addCriterion',
            categoryId: U.$('#nc-cat', root).value,
            criterion: {
              id,
              name,
              w: Number(U.$('#nc-w', root).value) || 1,
              hint: U.$('#nc-hint', root).value.trim()
            }
          })
          close()
          U.toast('Критерий добавлен', 'good')
        })
      }
    })
  }

  function openNewGenre() {
    U.openModal({
      title: 'Новый жанр',
      width: 560,
      body:
        '<div class="form-grid">' +
        '<div class="field span4"><label>Название жанра</label><input type="text" id="ng-name" placeholder="Например, тактический рогалик"></div>' +
        '<div class="field span4"><label>Что важно в жанре</label><textarea id="ng-note" placeholder="Подсказка для себя: на что смотреть в первую очередь"></textarea></div>' +
        '</div>' +
        '<div class="tiny dim" style="margin-top:10px">Сначала все категории получат вес ×1. Тонкую настройку можно сделать патчем через updateGenre.</div>',
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Добавить</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root).addEventListener('click', close)
        U.$('[data-save]', root).addEventListener('click', async () => {
          const name = U.$('#ng-name', root).value.trim()
          if (!name) { U.toast('Введите название жанра', 'bad'); return }
          await pushUserOp({
            op: 'addGenre',
            genre: { id: U.uid('genre'), name, note: U.$('#ng-note', root).value.trim(), profile: {} }
          })
          close()
          U.toast('Жанр добавлен', 'good')
        })
      }
    })
  }

  function openNewField() {
    U.openModal({
      title: 'Новое поле',
      width: 560,
      body:
        '<div class="form-grid">' +
        '<div class="field span2"><label>Название поля</label><input type="text" id="nf-label" placeholder="Например, любимый момент"></div>' +
        '<div class="field span2"><label>Тип</label><select id="nf-type"><option value="text">Строка</option><option value="textarea">Текст</option><option value="number">Число</option><option value="date">Дата</option></select></div>' +
        '</div>' +
        '<div class="tiny dim" style="margin-top:10px">Поле появится в карточке каждой оценки и в экспорте Markdown.</div>',
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Добавить</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root).addEventListener('click', close)
        U.$('[data-save]', root).addEventListener('click', async () => {
          const label = U.$('#nf-label', root).value.trim()
          if (!label) { U.toast('Введите название поля', 'bad'); return }
          await pushUserOp({
            op: 'addField',
            field: { key: 'field_' + U.uid('f').replace('f_', ''), label, type: U.$('#nf-type', root).value, placeholder: '' }
          })
          close()
          U.toast('Поле добавлено', 'good')
        })
      }
    })
  }

  /* ---------- настройки ---------- */

  function renderSettings(view) {
    const info = app().info
    const settings = app().settings
    const profile = app().profile
    const catalog = app().catalog(null)
    const criteriaCount = catalog.categories.reduce((n, c) => n + c.criteria.length, 0)

    let html = pageHead('Приложение', 'Настройки', 'Оформление, данные и информация о приложении.')

    html += '<div class="two-col"><div style="display:flex;flex-direction:column;gap:14px">'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Оформление</div><div class="card-sub">Акцент применяется ко всему интерфейсу</div></div></div>' +
      '<div class="field"><label>Акцентный цвет</label><div class="swatches" id="st-colors">' +
      ACCENTS.map((c) => '<button type="button" class="swatch' + (c.toLowerCase() === String(profile.accent).toLowerCase() ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>').join('') +
      '</div></div>' +
      '<div class="divider"></div>' +
      '<div class="row"><div class="grow"><div class="small" style="font-weight:600">Подсказки к критериям</div><div class="tiny dim">Короткое описание под каждым критерием</div></div>' +
      '<button class="switch' + (settings.showHints ? ' on' : '') + '" id="st-hints"></button></div>' +
      '<div class="divider"></div>' +
      '<div class="row"><div class="grow"><div class="small" style="font-weight:600">Шаг оценки</div><div class="tiny dim">Точность ползунка</div></div>' +
      '<select id="st-step" style="width:110px"><option value="0.5"' + (settings.step === 0.5 ? ' selected' : '') + '>0,5</option><option value="1"' + (settings.step === 1 ? ' selected' : '') + '>1</option></select></div>' +
      '</div>'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">База данных</div><div class="card-sub">Всё хранится на этом компьютере</div></div>' +
      '<span class="chip good">' + U.esc(info.backend === 'sqlite' ? 'SQLite' : info.backend) + '</span></div>' +
      '<div class="tiny dim" style="line-height:1.7;word-break:break-all"><b style="color:var(--muted)">Файл:</b> ' + U.esc(info.dbPath) + '</div>' +
      '<div class="row wrap" style="gap:8px;margin-top:12px">' +
      '<button class="btn" data-action="open-folder">Открыть папку</button>' +
      '<button class="btn" data-action="export-json">' + U.icon('export', 14) + ' Экспорт</button>' +
      '<button class="btn" data-action="import-json">' + U.icon('import', 14) + ' Импорт</button>' +
      '<span class="spacer"></span><button class="btn danger" data-action="reset">Сбросить</button></div>' +
      '</div>'

    html += '</div><div style="display:flex;flex-direction:column;gap:14px">'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">Система оценки</div><div class="card-sub">Текущий набор критериев</div></div></div>' +
      '<div class="row" style="padding:7px 0"><span class="small muted">Критериев</span><span class="spacer"></span><span class="mono">' + criteriaCount + '</span></div>' +
      '<div class="row" style="padding:7px 0"><span class="small muted">Категорий</span><span class="spacer"></span><span class="mono">' + catalog.categories.length + '</span></div>' +
      '<div class="row" style="padding:7px 0"><span class="small muted">Жанров</span><span class="spacer"></span><span class="mono">' + catalog.genres.length + '</span></div>' +
      '<div class="row" style="padding:7px 0"><span class="small muted">Патчей</span><span class="spacer"></span><span class="mono">' + app().patches.length + '</span></div>' +
      '<div class="divider"></div>' +
      '<div class="formula-strip"><span></span><span></span><span></span></div>' +
      '<div class="formula-legend" style="margin-top:8px"><span><i class="dot" style="background:var(--accent)"></i>60</span><span><i class="dot" style="background:#7c8f80"></i>25</span><span><i class="dot" style="background:#9c8e64"></i>15</span></div>' +
      '</div>'

    html += '<div class="card pad"><div class="card-head"><div><div class="card-title">О приложении</div><div class="card-sub">Критериум</div></div></div>' +
      '<div class="row" style="padding:6px 0"><span class="small muted">Версия</span><span class="spacer"></span><span class="tiny mono">' + U.esc(info.version) + '</span></div>' +
      '<div class="row" style="padding:6px 0"><span class="small muted">Electron</span><span class="spacer"></span><span class="tiny mono">' + U.esc(info.electron) + '</span></div>' +
      '<div class="row" style="padding:6px 0"><span class="small muted">Node</span><span class="spacer"></span><span class="tiny mono">' + U.esc(info.node) + '</span></div>' +
      '<div class="row" style="padding:6px 0"><span class="small muted">Chromium</span><span class="spacer"></span><span class="tiny mono">' + U.esc(info.chrome) + '</span></div>' +
      '<div class="divider"></div>' +
      '<div class="tiny dim" style="line-height:1.65">Локальный профиль. Никаких сетевых запросов: все данные лежат в SQLite-файле и доступны через экспорт.</div>' +
      '</div>'

    html += '</div></div>'
    view.innerHTML = shell(html)

    U.$$('[data-color]', view).forEach((btn) => btn.addEventListener('click', async () => {
      await api.profile.save({ accent: btn.dataset.color })
      app().profile.accent = btn.dataset.color
      document.documentElement.style.setProperty('--accent', btn.dataset.color)
      U.$$('[data-color]', view).forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const mini = U.$('#profile-mini')
      if (mini) mini.style.borderColor = 'color-mix(in srgb, ' + btn.dataset.color + ' 30%, transparent)'
      U.toast('Акцент обновлён', 'good')
    }))

    U.$('#st-hints', view).addEventListener('click', async (e) => {
      const on = !e.currentTarget.classList.contains('on')
      e.currentTarget.classList.toggle('on', on)
      app().settings.showHints = on
      await api.meta.set('showHints', on)
      U.toast(on ? 'Подсказки включены' : 'Подсказки скрыты', 'good')
    })

    U.$('#st-step', view).addEventListener('change', async (e) => {
      const step = Number(e.target.value) === 1 ? 1 : 0.5
      app().settings.step = step
      await api.meta.set('step', step)
      U.toast('Шаг оценки: ' + String(step).replace('.', ','), 'good')
    })

    U.$('[data-action="open-folder"]', view).addEventListener('click', () => api.data.folder())
    U.$('[data-action="export-json"]', view).addEventListener('click', exportJson)
    U.$('[data-action="import-json"]', view).addEventListener('click', importJson)
    U.$('[data-action="reset"]', view).addEventListener('click', resetAll)
  }

  window.K.Pages = { renderProfile, renderPatches, renderSettings }
})()
