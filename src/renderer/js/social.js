/* Общий каталог игр, публичные профили и учётная запись Supabase. */
window.K = window.K || {};

(function () {
  'use strict'

  const U = window.K.util
  const api = window.krit
  let catalogSearch = ''
  let catalogSection = 'featured'
  let catalogRegion = 'ru'
  let catalogToken = 0
  let catalogStart = 0
  let catalogTotal = 0
  let catalogHasMore = false
  let catalogLoading = false
  let catalogGames = []
  let catalogObserver = null
  let catalogPendingReset = false
  let catalogAutoSkips = 0
  const CATALOG_PAGE_SIZE = 25
  let profileSearch = ''
  let accountMode = 'signin'
  let searchTimer = null
  let devReviewsFilter = 'all'
  let devReviewsSearch = ''
  let devReviewsRows = []

  const REGION_OPTIONS = [
    ['ru', '₽ RUB · Россия'],
    ['kz', '₸ KZT · Казахстан'],
    ['us', '$ USD · США'],
    ['de', '€ EUR · Германия'],
    ['ua', '₴ UAH · Украина']
  ]
  const CURRENCY_SIGNS = { RUB: '₽', KZT: '₸', USD: '$', EUR: '€', UAH: '₴' }

  const DEV_REVIEW_FILTERS = [
    ['all', 'Все'],
    ['approved', 'Опубликованные'],
    ['pending', 'На модерации'],
    ['rejected', 'Отклонённые']
  ]

  function devStatusChip(status, isPublic) {
    if (status === 'pending') return '<span class="chip" style="color:#e4c887;border-color:rgba(228,200,135,.3)">на модерации</span>'
    if (status === 'rejected' || isPublic === false) return '<span class="chip bad">скрыта / отклонена</span>'
    return '<span class="chip good">опубликована</span>'
  }

  function regionLabel(code) {
    const found = REGION_OPTIONS.find(([id]) => id === code)
    return found ? found[1] : '₽ RUB · Россия'
  }

  function formatPrice(value, currency) {
    const num = Number(value)
    if (!Number.isFinite(num)) return ''
    const code = String(currency || 'RUB').toUpperCase()
    const sign = CURRENCY_SIGNS[code] || code
    const amount = num >= 100 ? Math.round(num) : Math.round(num * 100) / 100
    const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
    return code === 'USD' || code === 'EUR' ? sign + formatted : formatted + ' ' + sign
  }

  function shell(html) {
    return '<div class="view-inner">' + html + '</div>'
  }

  function head(eyebrow, title, text, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + U.esc(eyebrow) + '</div>' +
      '<h1 class="page-title">' + U.esc(title) + '</h1>' +
      (text ? '<p class="page-sub">' + U.esc(text) + '</p>' : '') +
      '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>'
  }

  function cardTitle(title, sub) {
    return '<div class="card-head"><div><div class="card-title">' + U.esc(title) + '</div>' +
      (sub ? '<div class="card-sub">' + U.esc(sub) + '</div>' : '') + '</div></div>'
  }

  function authNeeded() {
    return '<div class="empty"><h3>Нужен аккаунт</h3><p>Войдите, чтобы добавлять игры в общий каталог, публиковать оценки и смотреть профили других участников.</p>' +
      '<button class="btn primary sm" data-route="#/account">Войти или создать аккаунт</button></div>'
  }

  async function getStatus() {
    try {
      const status = await api.cloud.status()
      window.K.app.cloudStatus = status
      return status
    } catch (err) {
      return { configured: false, signedIn: false, error: err.message || String(err) }
    }
  }

  /* ---------- аккаунт ---------- */

  function isProfileOrAccountRoute() {
    return location.hash === '#/profile' || location.hash === '#/account'
  }

  async function renderAccount(mountEl, pageView) {
    const target = mountEl || U.$('#view')
    const rootView = pageView || target
    if (!target) return
    target.innerHTML = '<div class="subhead"><h3>Аккаунт и сообщество</h3><div class="line"></div></div>' +
      '<div class="card pad"><div class="small muted">Загрузка аккаунта…</div></div>'

    const status = await getStatus()
    if (!target.isConnected || !isProfileOrAccountRoute()) return
    if (!status.configured) return renderCloudSetup(target, status, rootView)
    if (status.signedIn) return renderSignedIn(target, status, rootView)
    return renderAuthForm(target, status, rootView)
  }

  function renderCloudSetup(view, status, rootView) {
    const urlValue = U.attr(status.url || '')
    const html = '<div class="subhead"><h3>Подключение общей базы</h3><div class="line"></div></div>' +
      (status.error ? '<div class="chip bad" style="margin-bottom:14px">' + U.esc(status.error) + '</div>' : '') +
      '<div class="card pad" style="max-width:760px">' + cardTitle('Настройка Supabase', 'URL и публичный ключ проекта; ключ хранится локально на этом компьютере.') +
      '<div class="form-grid">' +
      '<div class="field span4"><label>Project URL</label><input id="cloud-url" type="text" autocomplete="off" value="' + urlValue + '" placeholder="https://ваш-проект.supabase.co"></div>' +
      '<div class="field span4"><label>Публичный ключ (publishable / anon)</label><input id="cloud-key" type="text" autocomplete="off" spellcheck="false" placeholder="sb_publishable_… или anon key"></div>' +
      '</div><div class="row wrap" style="margin-top:14px"><button class="btn primary" id="cloud-save">Подключить</button>' +
      '<span class="tiny dim">Не вставляйте сюда service_role key.</span><span class="spacer"></span>' +
      '<button class="btn ghost sm" id="cloud-download-schema">Скачать SQL-схему</button></div>' +
      '<div class="divider"></div><div class="tiny dim" style="line-height:1.65">Сначала создайте проект Supabase, скачайте SQL-схему и выполните её в SQL Editor. После подключения можно будет создать аккаунт. Инструкция находится в README.</div></div>'
    view.innerHTML = html
    U.$('#cloud-save', view).addEventListener('click', async () => {
      const button = U.$('#cloud-save', view)
      button.disabled = true
      button.textContent = 'Подключаем…'
      try {
        const updated = await api.cloud.configure({ url: U.$('#cloud-url', view).value, anonKey: U.$('#cloud-key', view).value })
        window.K.app.cloudStatus = updated
        await window.K.app.reloadCloudPatches(false)
        U.toast('Общая база подключена', 'good')
        renderAccount(view, rootView)
      } catch (err) {
        U.toast(err.message || 'Не удалось подключиться', 'bad')
        button.disabled = false
        button.textContent = 'Подключить'
      }
    })
    U.$('#cloud-download-schema', view).addEventListener('click', async () => {
      try {
        const sql = await api.cloud.setupSql()
        const result = await api.data.saveText({
          defaultName: 'kriterium-supabase-schema.sql',
          content: sql,
          filters: [{ name: 'SQL', extensions: ['sql'] }]
        })
        if (result.ok) U.toast('SQL-схема сохранена', 'good')
      } catch (err) { U.toast(err.message || 'Не удалось сохранить схему', 'bad') }
    })
  }

  function renderAuthForm(view, status, rootView) {
    const registering = accountMode === 'signup'
    const html = '<div class="subhead"><h3>Аккаунт сообщества</h3><div class="line"></div><span class="tiny dim">публикация рецензий и общий профиль</span></div>' +
      '<div class="card pad" style="max-width:650px">' +
      cardTitle(registering ? 'Создать аккаунт' : 'Войти в аккаунт', 'Войдите, чтобы публиковать оценки в общем каталоге и открыть свой профиль другим участникам.') +
      '<div class="tabs" style="margin-bottom:16px"><button class="tab' + (!registering ? ' active' : '') + '" data-mode="signin">Войти</button>' +
      '<button class="tab' + (registering ? ' active' : '') + '" data-mode="signup">Регистрация</button></div>' +
      '<div class="form-grid">' +
      (registering ? '<div class="field span4"><label>Имя в профиле</label><input id="cloud-display" type="text" maxlength="60" value="' + U.attr(window.K.app.profile?.nickname || '') + '" placeholder="Как вас будут видеть другие"></div>' : '') +
      '<div class="field span4"><label>Электронная почта</label><input id="cloud-email" type="email" maxlength="254" autocomplete="email" placeholder="name@example.com"></div>' +
      '<div class="field span4"><label>Пароль (не короче 10 символов)</label><input id="cloud-password" type="password" minlength="10" maxlength="128" autocomplete="' + (registering ? 'new-password' : 'current-password') + '"></div>' +
      '</div><div class="row wrap" style="margin-top:14px"><button class="btn primary" id="cloud-submit">' + (registering ? 'Создать аккаунт' : 'Войти') + '</button>' +
      '<span class="spacer"></span><button class="btn ghost sm" id="cloud-change-project">Параметры подключения</button></div>' +
      '<p class="tiny dim" style="margin-top:12px;line-height:1.6">Пароль отправляется только в Supabase по HTTPS. Сессия шифруется средствами Windows и хранится локально.</p></div>'
    view.innerHTML = html

    U.$$('[data-mode]', view).forEach((button) => button.addEventListener('click', () => {
      accountMode = button.dataset.mode
      renderAuthForm(view, status, rootView)
    }))
    U.$('#cloud-change-project', view).addEventListener('click', async () => {
      await api.cloud.signOut()
      window.K.app.cloudStatus = await api.cloud.status()
      await window.K.app.reloadCloudPatches(false)
      renderCloudSetup(view, { configured: false, url: status.url }, rootView)
    })
    U.$('#cloud-submit', view).addEventListener('click', async () => {
      const button = U.$('#cloud-submit', view)
      button.disabled = true
      button.textContent = registering ? 'Создаём…' : 'Входим…'
      const input = {
        email: U.$('#cloud-email', view).value,
        password: U.$('#cloud-password', view).value
      }
      try {
        if (registering) {
          input.displayName = U.$('#cloud-display', view).value
          const result = await api.cloud.signUp(input)
          if (result.confirmationRequired) {
            U.toast('Проверьте почту и подтвердите регистрацию', 'good')
            accountMode = 'signin'
            renderAuthForm(view, status, rootView)
            return
          }
        } else {
          await api.cloud.signIn(input)
        }
        window.K.app.cloudStatus = await api.cloud.status()
        await window.K.app.reloadCloudPatches(false)
        U.toast(registering ? 'Аккаунт создан' : 'Вы вошли', 'good')
        if (window.K.Pages?.renderProfile && rootView) window.K.Pages.renderProfile(rootView)
        else renderAccount(view, rootView)
      } catch (err) {
        U.toast(err.message || 'Не удалось выполнить вход', 'bad')
        button.disabled = false
        button.textContent = registering ? 'Создать аккаунт' : 'Войти'
      }
    })
  }

  const BADGE_CATALOG = [
    {
      id: 'developer_kriterium',
      title: 'Разработчик Критериум',
      description: 'Создатель и единственный владелец платформы «Критериум»',
      icon: 'crown',
      style: 'gold'
    },
    {
      id: 'beta_test',
      title: 'Beta test',
      description: 'Первопроходец и участник закрытого бета-тестирования «Критериума»',
      icon: 'beta',
      style: 'emerald'
    },
    {
      id: 'first_wave',
      title: 'Первая волна',
      description: 'Один из первых участников сообщества «Критериум»',
      icon: 'bolt',
      style: 'amber'
    },
    {
      id: 'top_critic',
      title: 'Ведущий критик',
      description: 'За глубокие и аргументированные разборы игр по критериям',
      icon: 'trophy',
      style: 'gold'
    },
    {
      id: 'genre_expert',
      title: 'Знаток жанра',
      description: 'За серию подробных оценок внутри жанрового направления',
      icon: 'target',
      style: 'steel'
    },
    {
      id: 'trusted_reviewer',
      title: 'Проверенный автор',
      description: 'Автор содержательных рецензий сообщества «Критериум»',
      icon: 'star',
      style: 'violet'
    }
  ]

  const BADGE_SVGS = {
    crown: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M2.5 14.5 4 6.5l4.2 3.3L10 4.5l1.8 5.3L16 6.5l1.5 8H2.5Z" fill="currentColor" opacity=".25"/><path d="M2.5 14.5 4 6.5l4.2 3.3L10 4.5l1.8 5.3L16 6.5l1.5 8H2.5Zm0 2h15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    beta: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M10 2.2 16.5 6v8L10 17.8 3.5 14V6L10 2.2Z" fill="currentColor" opacity=".22"/><path d="M10 2.2 16.5 6v8L10 17.8 3.5 14V6L10 2.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.5 6.8h2.8a1.8 1.8 0 0 1 0 3.5H7.5V6.8Zm0 3.5h3.2a1.8 1.8 0 0 1 0 3.5H7.5v-3.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M11 2.5 4.8 10.8h4.5l-.8 6.7 6.7-8.5h-4.6L11 2.5Z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    trophy: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M6 3.5h8v4a4 4 0 0 1-8 0v-4ZM6 5H3.8v1.5a2.7 2.7 0 0 0 2.4 2.7M14 5h2.2v1.5a2.7 2.7 0 0 1-2.4 2.7M10 11.5v3.5M6.8 16h6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    target: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="3.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/></svg>',
    star: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="m10 2.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7L10 2.6Z" fill="currentColor" opacity=".24" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  }

  function badgeIconHtml(badge) {
    const key = badge?.icon || (badge?.id === 'beta_test' ? 'beta' : badge?.id === 'developer_kriterium' ? 'crown' : '')
    if (BADGE_SVGS[key]) return BADGE_SVGS[key]
    return U.esc(badge?.icon || '👑')
  }

  function badgeStyleClass(badge) {
    if (badge?.style) return badge.style
    if (badge?.id === 'beta_test') return 'emerald'
    const preset = BADGE_CATALOG.find((x) => x.id === badge?.id)
    return preset?.style || 'gold'
  }

  function badgeList(profile, isDeveloper) {
    const raw = Array.isArray(profile?.badges) ? profile.badges.slice() : []
    if (isDeveloper && !raw.some((b) => b && b.id === 'developer_kriterium')) {
      raw.unshift(BADGE_CATALOG[0])
    }
    return raw.filter((b) => b && b.title).map((b) => {
      const preset = BADGE_CATALOG.find((x) => x.id === b.id)
      return Object.assign({}, preset || {}, b)
    })
  }

  function badgePillsHtml(profile, isDeveloper) {
    return badgeList(profile, isDeveloper).map((b) =>
      '<span class="ach-pill ' + U.attr(badgeStyleClass(b)) + '" title="' + U.attr(b.description || b.title) + '">' + badgeIconHtml(b) + '<span>' + U.esc(b.title) + '</span></span>'
    ).join('')
  }

  function badgeCardsHtml(profile, isDeveloper) {
    const list = badgeList(profile, isDeveloper)
    if (!list.length) return '<div class="small dim">Пока нет наград.</div>'
    return '<div style="display:flex;flex-direction:column;gap:10px">' + list.map((b) =>
      '<div class="ach-card ' + U.attr(badgeStyleClass(b)) + '"><div class="ach-icon">' + badgeIconHtml(b) + '</div><div><div class="ach-title">' + U.esc(b.title) + '</div>' +
      (b.description ? '<div class="ach-desc">' + U.esc(b.description) + '</div>' : '') + '</div></div>'
    ).join('') + '</div>'
  }

  async function renderSignedIn(view, status, rootView) {
    let profile = null
    let isDeveloper = false
    let profileError = ''
    try {
      ;[profile, isDeveloper] = await Promise.all([api.cloud.myProfile(), api.cloud.isDeveloper()])
    } catch (err) {
      profileError = err.message || String(err)
    }
    if (!view.isConnected || !isProfileOrAccountRoute()) return
    const role = isDeveloper ? '<span class="chip accent">Разработчик приложения</span>' : '<span class="chip good">Участник</span>'
    const pills = badgePillsHtml(profile, isDeveloper)

    // Обновляем единую шапку профиля сверху, чтобы не дублировать карточку героя.
    if (rootView) {
      const heroAvatar = U.$('#profile-hero-avatar', rootView)
      if (heroAvatar && profile?.avatar) heroAvatar.textContent = profile.avatar
      const heroName = U.$('#profile-hero-name', rootView)
      if (heroName && profile?.display_name) heroName.textContent = profile.display_name
      const heroSub = U.$('#profile-hero-sub', rootView)
      if (heroSub) {
        const handlePart = profile?.handle ? '@' + profile.handle : ''
        const emailPart = status.user?.email || ''
        const bioPart = profile?.bio || window.K.app.profile?.tagline || ''
        heroSub.textContent = [handlePart, emailPart, bioPart].filter(Boolean).join(' · ') || 'Без описания'
      }
      const heroChips = U.$('#local-profile-chips', rootView)
      if (heroChips) {
        const played = (window.K.app.games || []).length
        heroChips.innerHTML = pills + role +
          '<span class="chip">' + (profile?.is_public ? 'профиль открыт' : 'профиль закрыт') + '</span>' +
          '<span class="chip">' + played + ' ' + U.plural(played, 'игра', 'игры', 'игр') + '</span>'
      }
    }

    const html = '<div class="subhead"><h3>Аккаунт и сообщество</h3><div class="line"></div><span class="tiny dim">' + U.esc(status.user?.email || '') + '</span></div>' +
      (profileError ? '<div class="chip bad" style="margin-bottom:14px">' + U.esc(profileError) + '</div>' : '') +
      '<div class="two-col"><div class="card pad">' + cardTitle('Публичный профиль', 'Синхронизируется с локальным профилем и виден другим участникам, если открыт.') +
      '<div class="form-grid"><div class="field span2"><label>Имя</label><input id="pub-display" type="text" maxlength="60" value="' + U.attr(profile?.display_name || window.K.app.profile?.nickname || '') + '"></div>' +
      '<div class="field span2"><label>Адрес профиля (@handle)</label><input id="pub-handle" type="text" maxlength="24" value="' + U.attr(profile?.handle || '') + '" placeholder="латиница, цифры, _"></div>' +
      '<div class="field span4"><label>О себе</label><textarea id="pub-bio" maxlength="280" placeholder="Коротко о ваших игровых вкусах">' + U.esc(profile?.bio || window.K.app.profile?.tagline || '') + '</textarea></div>' +
      '</div><label class="row small muted" style="margin-top:10px"><input id="pub-open" type="checkbox" style="accent-color:var(--accent)"' + (profile?.is_public ? ' checked' : '') + '> Показывать профиль и мои публичные оценки другим участникам</label>' +
      '<div class="row wrap" style="gap:8px;margin-top:14px"><button class="btn primary" id="pub-save">Сохранить профиль</button>' +
      (profile?.handle ? '<button class="btn ghost" data-route="#/person/' + U.attr(profile.handle) + '">Как видят другие</button>' : '') +
      '<span class="spacer"></span><button class="btn ghost" id="cloud-signout">Выйти из аккаунта</button></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:14px"><div class="card pad">' + cardTitle('Достижения в профиле', 'Выдаются сервером и видны всем участникам.') +
      badgeCardsHtml(profile, isDeveloper) + '</div>' +
      '<div class="card pad">' + cardTitle('Моя роль', 'Права разработчика назначает только владелец проекта Supabase.') +
      (isDeveloper ? '<p class="small muted">У вас есть права управлять общим каталогом, внешними оценками, публичными отзывами и официальными патчами.</p>' : '<p class="small muted">Сейчас у вас права участника: можно оценивать игры и управлять своим профилем. Изменять общие данные и патчи нельзя.</p>' +
        '<button class="btn ghost sm" id="cloud-download-developer-sql" style="margin-top:12px">Скачать SQL для аккаунта разработчика</button>') +
      '</div></div></div>' +
      (isDeveloper ? '<div class="card pad" id="moderation-card" style="margin-top:16px">' +
        cardTitle('Очередь модерации', 'Сюда автоматически попадают подозрительные рецензии: мат, спам и противоречивые оценки.') +
        '<div id="moderation-list"><div class="small muted">Загружаем очередь…</div></div></div>' : '') +
      (isDeveloper ? '<div class="card pad" id="dev-reviews-card" style="margin-top:16px">' +
        cardTitle('Все рецензии участников', 'Вы можете отредактировать, скрыть, отклонить или удалить любую рецензию.') +
        '<div class="tools" style="margin:12px 0 10px 0"><label class="search">' + U.icon('search', 15) +
        '<input id="dev-reviews-search" type="text" maxlength="60" placeholder="Имя, игра или текст…" value="' + U.attr(devReviewsSearch) + '"></label></div>' +
        '<div class="tabs" id="dev-reviews-tabs" style="margin-bottom:12px">' +
        DEV_REVIEW_FILTERS.map(([id, label]) =>
          '<button class="tab' + (devReviewsFilter === id ? ' active' : '') + '" data-dev-filter="' + id + '">' + U.esc(label) + '</button>'
        ).join('') + '</div>' +
        '<div id="dev-reviews-list"><div class="small muted">Загружаем рецензии…</div></div></div>' : '')
    view.innerHTML = html
    U.$('#cloud-signout', view).addEventListener('click', async () => {
      await api.cloud.signOut()
      window.K.app.cloudStatus = await api.cloud.status()
      await window.K.app.reloadCloudPatches(false)
      if (window.K.Pages?.renderProfile && rootView) window.K.Pages.renderProfile(rootView)
      else renderAccount(view, rootView)
    })
    U.$('#cloud-download-developer-sql', view)?.addEventListener('click', async () => {
      try {
        const sql = await api.cloud.bootstrapSql(status.user?.email)
        const result = await api.data.saveText({
          defaultName: 'kriterium-developer-account.sql',
          content: sql,
          filters: [{ name: 'SQL', extensions: ['sql'] }]
        })
        if (result.ok) U.toast('Скрипт сохранён. Выполните его в SQL Editor своего проекта Supabase.', 'good')
      } catch (err) { U.toast(err.message || 'Не удалось подготовить скрипт', 'bad') }
    })
    U.$('#pub-save', view).addEventListener('click', async () => {
      const button = U.$('#pub-save', view)
      button.disabled = true
      const displayName = U.$('#pub-display', view).value.trim()
      const handle = U.$('#pub-handle', view).value.trim()
      const bio = U.$('#pub-bio', view).value.trim()
      const isPublic = U.$('#pub-open', view).checked
      try {
        profile = await api.cloud.updateMyProfile({ displayName, handle, bio, isPublic })
        if (displayName) {
          await api.profile.save({ nickname: displayName, tagline: bio.slice(0, 120) })
          window.K.app.profile = await api.profile.get()
        }
        U.toast('Профиль сохранён', 'good')
        renderSignedIn(view, status, rootView)
      } catch (err) {
        U.toast(err.message || 'Не удалось сохранить профиль', 'bad')
        button.disabled = false
      }
    })
    if (isDeveloper) {
      U.$('#dev-reviews-search', view)?.addEventListener('input', (event) => {
        devReviewsSearch = event.target.value
        renderDeveloperReviewsList(view)
      })
      U.$$('[data-dev-filter]', view).forEach((btn) => btn.addEventListener('click', () => {
        devReviewsFilter = btn.dataset.devFilter
        U.$$('[data-dev-filter]', view).forEach((b) => b.classList.toggle('active', b === btn))
        loadDeveloperReviews(view)
      }))
      loadModerationQueue(view)
      loadDeveloperReviews(view)
    }
  }

  async function loadModerationQueue(view) {
    const box = U.$('#moderation-list', view)
    if (!box) return
    try {
      const rows = await api.cloud.listModerationQueue()
      if (!box.isConnected) return
      if (!rows.length) {
        box.innerHTML = '<div class="empty" style="padding:22px 10px"><h3>Очередь пуста</h3><p>Подозрительных рецензий сейчас нет — все публикации прошли автопроверку.</p></div>'
        return
      }
      box.innerHTML = '<div class="mod-queue">' + rows.map((review) => {
        const profile = review.profile || {}
        const game = review.game || {}
        const reasons = Array.isArray(review.moderation_reasons) ? review.moderation_reasons : []
        return '<div class="mod-queue-item" data-mod-id="' + U.attr(review.id) + '">' +
          '<div class="row wrap" style="gap:10px;align-items:center">' +
            '<span class="mini-avatar">' + U.esc(profile.avatar || '🎮') + '</span>' +
            '<div class="grow"><div class="row wrap" style="gap:7px"><b>' + U.esc(profile.display_name || profile.handle || 'Участник') + '</b>' +
              (game.title ? '<span class="tiny dim">· ' + U.esc(game.title) + '</span>' : '') + '</div>' +
              '<div class="tiny dim">@' + U.esc(profile.handle || '') + ' · ' + U.esc(U.formatDate(review.updated_at)) + '</div></div>' +
            '<b class="mono" style="color:' + U.scoreColor(review.score) + '">' + U.formatNumber(review.score) + '</b>' +
          '</div>' +
          (reasons.length ? '<div class="mod-queue-reasons">' + reasons.map((r) => '<span class="tiny">• ' + U.esc(r) + '</span>').join('') + '</div>' : '') +
          ((review.verdict || review.pros || review.cons) ? '<div class="mod-queue-text">' + U.esc([review.verdict, review.pros, review.cons].filter(Boolean).join(' ')).slice(0, 420) + '</div>' : '') +
          '<div class="row wrap" style="gap:8px;margin-top:9px">' +
            '<button class="btn sm primary" data-mod-action="approve">Одобрить</button>' +
            '<button class="btn sm" data-mod-action="reject">Отклонить</button>' +
            (game.steam_app_id ? '<button class="btn ghost sm" data-route="#/steam/' + Number(game.steam_app_id) + '">Страница игры</button>' : '') +
          '</div></div>'
      }).join('') + '</div>'
      U.$$('[data-mod-action]', box).forEach((btn) => btn.addEventListener('click', async (event) => {
        event.stopPropagation()
        const item = btn.closest('[data-mod-id]')
        const id = item?.dataset.modId
        if (!id) return
        const action = btn.dataset.modAction
        U.$$('[data-mod-action]', item).forEach((b) => { b.disabled = true })
        btn.textContent = action === 'approve' ? 'Одобряем…' : 'Отклоняем…'
        try {
          await api.cloud.moderateReview(id, action)
          U.toast(action === 'approve' ? 'Рецензия одобрена и опубликована' : 'Рецензия отклонена', 'good')
          loadModerationQueue(view)
        } catch (err) {
          U.toast(err.message || 'Не удалось выполнить действие', 'bad')
          U.$$('[data-mod-action]', item).forEach((b) => { b.disabled = false })
          btn.textContent = action === 'approve' ? 'Одобрить' : 'Отклонить'
        }
      }))
    } catch (err) {
      if (box.isConnected) box.innerHTML = '<div class="empty" style="padding:20px"><h3>Не удалось загрузить очередь</h3><p>' + U.esc(err.message || String(err)) + '</p></div>'
    }
  }

  async function loadDeveloperReviews(view) {
    const box = U.$('#dev-reviews-list', view)
    if (!box) return
    box.innerHTML = '<div class="small muted">Загружаем рецензии…</div>'
    try {
      const rows = await api.cloud.listDeveloperReviews({
        status: devReviewsFilter === 'all' ? '' : devReviewsFilter
      })
      devReviewsRows = Array.isArray(rows) ? rows : []
      renderDeveloperReviewsList(view)
    } catch (err) {
      if (box.isConnected) box.innerHTML = '<div class="empty" style="padding:20px"><h3>Не удалось загрузить список</h3><p>' + U.esc(err.message || String(err)) + '</p></div>'
    }
  }

  function renderDeveloperReviewsList(view) {
    const box = U.$('#dev-reviews-list', view)
    if (!box) return
    if (!devReviewsRows.length) {
      box.innerHTML = '<div class="empty" style="padding:22px 10px"><h3>Рецензий нет</h3><p>В выбранном фильтре пока нет ни одной рецензии.</p></div>'
      return
    }
    const term = devReviewsSearch.trim().toLowerCase()
    const visible = term
      ? devReviewsRows.filter((r) => {
          const profile = r.profile || {}
          const game = r.game || {}
          const hay = [profile.display_name, profile.handle, game.title, r.verdict, r.pros, r.cons]
            .map((x) => String(x || '').toLowerCase())
            .join(' ')
          return hay.includes(term)
        })
      : devReviewsRows
    if (!visible.length) {
      box.innerHTML = '<div class="empty" style="padding:22px 10px"><h3>Ничего не найдено</h3><p>По этому поиску в выбранном фильтре совпадений нет.</p></div>'
      return
    }
    box.innerHTML = '<div class="mod-queue">' + visible.map((review) => {
      const profile = review.profile || {}
      const game = review.game || {}
      const excerpt = String([review.verdict, review.pros, review.cons].filter(Boolean).join(' ')).slice(0, 260)
      return '<div class="mod-queue-item" data-dev-review="' + U.attr(review.id) + '">' +
        '<div class="row wrap" style="gap:10px;align-items:center">' +
          '<span class="mini-avatar">' + U.esc(profile.avatar || '🎮') + '</span>' +
          '<div class="grow"><div class="row wrap" style="gap:7px">' +
            (profile.handle
              ? '<button class="text-link" data-route="#/person/' + U.attr(profile.handle) + '">' + U.esc(profile.display_name || profile.handle) + '</button>'
              : '<b>' + U.esc(profile.display_name || 'Участник') + '</b>') +
            (game.title
              ? (game.steam_app_id
                ? '<span class="tiny dim">·</span><button class="text-link" data-route="#/steam/' + Number(game.steam_app_id) + '">' + U.esc(game.title) + '</button>'
                : '<span class="tiny dim">·</span><span class="tiny">' + U.esc(game.title) + '</span>')
              : '') +
            '<span class="tiny dim">' + U.esc(U.formatDate(review.updated_at)) + '</span>' + devStatusChip(review.moderation_status, review.is_public) +
          '</div></div>' +
          '<b class="mono" style="color:' + U.scoreColor(review.score) + '">' + U.formatNumber(review.score) + '</b>' +
        '</div>' +
        (excerpt ? '<div class="mod-queue-text">' + U.esc(excerpt) + '</div>' : '') +
        '<div class="row wrap" style="gap:8px;margin-top:9px">' +
          '<button class="btn sm" data-dev-action="edit">Изменить</button>' +
          (review.moderation_status !== 'approved' || review.is_public === false ? '<button class="btn sm primary" data-dev-action="approve">Одобрить / показать</button>' : '') +
          (review.moderation_status !== 'rejected' ? '<button class="btn sm" data-dev-action="reject">Отклонить</button>' : '') +
          '<button class="btn sm ghost" data-dev-action="delete">Удалить</button>' +
          '<button class="btn sm ghost" data-dev-action="inspect">Полный разбор</button>' +
        '</div></div>'
    }).join('') + '</div>'

    U.$('#dev-reviews-list', view).querySelectorAll('[data-dev-action]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation()
        const item = btn.closest('[data-dev-review]')
        const id = item?.dataset.devReview
        const review = devReviewsRows.find((r) => String(r.id) === String(id))
        if (!review) return
        const action = btn.dataset.devAction
        if (action === 'inspect') {
          openCommunityReviewModal(review, review.game?.title || 'Игра')
          return
        }
        if (action === 'edit') {
          openDeveloperReviewEditModal(review, () => {
            loadDeveloperReviews(view)
            loadModerationQueue(view)
          })
          return
        }
        if (action === 'delete') {
          const ok = await U.confirmDialog({
            title: 'Удалить рецензию?',
            text: 'Рецензия «' + (review.game?.title || 'игра') + '» от ' + (review.profile?.display_name || review.profile?.handle || 'участника') + ' будет удалена безвозвратно.',
            confirmLabel: 'Удалить'
          })
          if (!ok) return
        }
        U.$$('[data-dev-action]', item).forEach((b) => { b.disabled = true })
        btn.textContent = action === 'approve' ? 'Показываем…' : action === 'reject' ? 'Отклоняем…' : 'Удаляем…'
        try {
          if (action === 'approve') await api.cloud.moderateReview(id, 'approve')
          else if (action === 'reject') await api.cloud.moderateReview(id, 'reject')
          else if (action === 'delete') await api.cloud.moderateReview(id, 'delete')
          U.toast(action === 'approve' ? 'Рецензия одобрена' : action === 'reject' ? 'Рецензия отклонена' : 'Рецензия удалена', action === 'delete' ? 'bad' : 'good')
          loadDeveloperReviews(view)
          loadModerationQueue(view)
        } catch (err) {
          U.toast(err.message || 'Не удалось выполнить действие', 'bad')
          U.$$('[data-dev-action]', item).forEach((b) => { b.disabled = false })
          btn.textContent = action === 'approve' ? 'Одобрить / показать' : action === 'reject' ? 'Отклонить' : action === 'delete' ? 'Удалить' : 'Изменить'
        }
      })
    })
  }

  function openDeveloperReviewEditModal(review, onChanged) {
    const profile = review.profile || {}
    const statusOptions = [
      ['approved', 'Опубликована'],
      ['pending', 'На модерации'],
      ['rejected', 'Отклонена']
    ]
    const body = '<div class="form-grid">' +
      '<div class="field span2"><label>Балл (0–100)</label><input id="dev-ed-score" type="number" min="0" max="100" step="0.1" value="' + (Number(review.score) || 0) + '"></div>' +
      '<div class="field span2"><label>Покрытие, %</label><input id="dev-ed-coverage" type="number" min="0" max="100" step="1" value="' + Math.round((Number(review.coverage) || 0) * 100) + '"></div>' +
      '<div class="field span2"><label>Статус модерации</label><select id="dev-ed-status">' +
        statusOptions.map(([id, label]) => '<option value="' + id + '"' + (review.moderation_status === id ? ' selected' : '') + '>' + U.esc(label) + '</option>').join('') +
      '</select></div>' +
      '<div class="field span2"><label>Видимость</label><label class="row small muted" style="margin-top:9px"><input id="dev-ed-public" type="checkbox" style="accent-color:var(--accent)"' + (review.is_public !== false ? ' checked' : '') + '> Показывать всем</label></div>' +
      '<div class="field span4"><label>Заголовок</label><input id="dev-ed-title" type="text" maxlength="120" value="' + U.attr(review.review_title || '') + '"></div>' +
      '<div class="field span4"><label>Вердикт</label><textarea id="dev-ed-verdict" spellcheck="true" lang="ru" style="min-height:90px">' + U.esc(review.verdict || '') + '</textarea></div>' +
      '<div class="field span2"><label>Сильные стороны</label><textarea id="dev-ed-pros" spellcheck="true" lang="ru" style="min-height:90px">' + U.esc(review.pros || '') + '</textarea></div>' +
      '<div class="field span2"><label>Слабые стороны</label><textarea id="dev-ed-cons" spellcheck="true" lang="ru" style="min-height:90px">' + U.esc(review.cons || '') + '</textarea></div>' +
      '</div>' +
      '<p class="tiny dim" style="margin-top:10px">Правки сохраняются сразу для всех участников и видны на странице игры и в профиле автора.</p>'

    U.openModal({
      title: 'Редактирование рецензии · ' + (profile.display_name || profile.handle || 'участник'),
      width: 760,
      body,
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Сохранить изменения</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root)?.addEventListener('click', close)
        U.$('[data-save]', root)?.addEventListener('click', async (e) => {
          const btn = e.currentTarget
          btn.disabled = true
          btn.textContent = 'Сохраняем…'
          const patch = {
            score: Number(U.$('#dev-ed-score', root).value) || 0,
            coverage: Math.max(0, Math.min(100, Number(U.$('#dev-ed-coverage', root).value) || 0)) / 100,
            moderation_status: U.$('#dev-ed-status', root).value,
            is_public: U.$('#dev-ed-public', root).checked,
            review_title: U.$('#dev-ed-title', root).value.trim(),
            verdict: U.$('#dev-ed-verdict', root).value,
            pros: U.$('#dev-ed-pros', root).value,
            cons: U.$('#dev-ed-cons', root).value
          }
          try {
            await api.cloud.developerEditReview(review.id, patch)
            close()
            U.toast('Рецензия обновлена', 'good')
            if (typeof onChanged === 'function') onChanged()
          } catch (err) {
            U.toast(err.message || 'Не удалось сохранить изменения', 'bad')
            btn.disabled = false
            btn.textContent = 'Сохранить изменения'
          }
        })
      }
    })
  }

  /* ---------- Steam catalog ---------- */

  const QUICK_GENRES = [
    ['RPG', 'RPG'],
    ['Roguelike', 'Рогалик'],
    ['Action', 'Экшен'],
    ['Strategy', 'Стратегия'],
    ['Horror', 'Хоррор'],
    ['Metroidvania', 'Метроидвания'],
    ['Shooter', 'Шутер'],
    ['Survival', 'Выживание'],
    ['Co-op', 'Кооператив'],
    ['Indie', 'Инди'],
    ['Puzzle', 'Головоломка']
  ]

  function renderCatalog(view) {
    if (catalogObserver) { catalogObserver.disconnect(); catalogObserver = null }
    const sections = [
      ['featured', 'Популярные и культовые'],
      ['top_sellers', 'Лидеры продаж Steam'],
      ['new_releases', 'Новинки Steam'],
      ['specials', 'Скидки Steam']
    ]
    const html = head('Каталог Steam', 'Каталог игр', 'Игры подтягиваются напрямую из Steam с обложками, жанрами, тегами, скриншотами и оценками.') +
      '<div class="tools" style="margin-bottom:10px"><label class="search">' + U.icon('search', 15) +
      '<input id="steam-search" type="text" maxlength="100" placeholder="Найти любую игру в Steam…" value="' + U.attr(catalogSearch) + '"></label>' +
      '<button class="btn primary" id="steam-search-button">Найти в Steam</button>' +
      (catalogSearch ? '<button class="btn ghost sm" id="steam-clear-button">Сбросить поиск</button>' : '') +
      '<label class="region-picker" title="Регион и валюта цен Steam">' + U.icon('globe', 14) +
      '<select id="steam-region">' + REGION_OPTIONS.map(([code, label]) =>
        '<option value="' + code + '"' + (catalogRegion === code ? ' selected' : '') + '>' + U.esc(label) + '</option>'
      ).join('') + '</select></label>' +
      '<span class="spacer"></span><span id="steam-result-count" class="tiny dim"></span></div>' +
      '<div class="row wrap" style="gap:8px;margin-bottom:12px">' +
      '<div class="tabs" id="steam-sections">' +
      sections.map(([id, label]) =>
        '<button class="tab' + (!catalogSearch && catalogSection === id ? ' active' : '') + '" data-section="' + id + '">' + U.esc(label) + '</button>'
      ).join('') + '</div>' +
      '<div class="row wrap" id="steam-quick-tags" style="gap:5px">' +
      QUICK_GENRES.map(([q, label]) =>
        '<button class="chip' + (catalogSearch.toLowerCase() === q.toLowerCase() ? ' accent' : '') + '" style="cursor:pointer" data-quick-tag="' + U.attr(q) + '">' + U.esc(label) + '</button>'
      ).join('') + '</div></div>' +
      '<div id="steam-results"></div>' +
      '<div id="steam-more" class="catalog-more"></div>' +
      '<div class="tiny dim" style="margin-top:16px;line-height:1.6">Каждая страница игры привязана к Steam App ID — оценки разных участников собираются на одной общей странице игры.</div>'
    view.innerHTML = shell(html)

    const input = U.$('#steam-search', view)
    const runSearch = async () => {
      catalogSearch = input.value.trim()
      renderCatalog(view)
    }
    U.$('#steam-search-button', view).addEventListener('click', runSearch)
    U.$('#steam-clear-button', view)?.addEventListener('click', () => {
      catalogSearch = ''
      renderCatalog(view)
    })
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch() })
    input.addEventListener('input', () => {
      clearTimeout(searchTimer)
      if (input.value.trim().length >= 3) {
        searchTimer = setTimeout(() => {
          catalogSearch = input.value.trim()
          loadCatalogResults(view)
        }, 550)
      }
    })
    U.$$('[data-section]', view).forEach((btn) => btn.addEventListener('click', () => {
      catalogSection = btn.dataset.section
      catalogSearch = ''
      renderCatalog(view)
    }))
    U.$$('[data-quick-tag]', view).forEach((btn) => btn.addEventListener('click', () => {
      catalogSearch = btn.dataset.quickTag
      renderCatalog(view)
    }))
    U.$('#steam-region', view)?.addEventListener('change', async (event) => {
      catalogRegion = event.target.value
      try { await api.cloud.setSteamRegion(catalogRegion) } catch { /* keep local choice */ }
      loadCatalogResults(view, { reset: true })
    })

    api.cloud.getSteamRegion().then((region) => {
      if (!view.isConnected) return
      if (region && region !== catalogRegion) {
        catalogRegion = region
        const select = U.$('#steam-region', view)
        if (select) select.value = region
      }
      loadCatalogResults(view, { reset: true })
    }).catch(() => loadCatalogResults(view, { reset: true }))
  }

  async function loadCatalogResults(view, options = {}) {
    const target = U.$('#steam-results', view)
    const count = U.$('#steam-result-count', view)
    const more = U.$('#steam-more', view)
    if (!target) return
    const reset = options.reset !== false
    if (reset) {
      catalogToken++
      catalogStart = 0
      catalogTotal = 0
      catalogHasMore = false
      catalogGames = []
      catalogAutoSkips = 0
      target.innerHTML = '<div class="card pad small muted">Загружаем каталог Steam…</div>'
      if (more) more.innerHTML = ''
    }
    if (catalogLoading) {
      // Сброс во время загрузки: результат текущего запроса уже устарел,
      // поэтому перезапускаем его сразу после завершения.
      if (reset) catalogPendingReset = true
      return
    }
    catalogPendingReset = false

    const token = catalogToken
    const requestRegion = catalogRegion
    const requestSearch = catalogSearch
    const requestSection = catalogSection
    catalogLoading = true
    if (more && !reset) more.innerHTML = '<div class="card pad small muted">Загружаем ещё игры…</div>'
    try {
      const page = await api.cloud.steamBrowse({
        query: requestSearch,
        section: requestSection,
        start: catalogStart,
        count: CATALOG_PAGE_SIZE,
        cc: requestRegion
      })
      const rawItems = Array.isArray(page?.items) ? page.items : []
      const knownIds = new Set(catalogGames.map((game) => game.steamAppId))
      const items = rawItems.filter((game) => !knownIds.has(game.steamAppId))
      if (rawItems.length && !items.length && page?.hasMore && catalogAutoSkips < 4) {
        // Steam иногда отдаёт пересекающиеся страницы — пропускаем пустую и идём дальше.
        catalogAutoSkips++
        catalogStart += rawItems.length
        queueMicrotask(() => {
          if (token === catalogToken && target.isConnected && location.hash === '#/catalog') {
            loadCatalogResults(view, { reset: false })
          }
        })
        return
      }
      if (items.length) {
        const commMap = await api.cloud.communityBySteamIds(items.map((r) => r.steamAppId)).catch(() => ({}))
        items.forEach((r) => {
          if (commMap && commMap[r.steamAppId]) r.community = commMap[r.steamAppId]
        })
      }
      if (!target.isConnected || location.hash !== '#/catalog' || catalogRegion !== requestRegion ||
          catalogSearch !== requestSearch || catalogSection !== requestSection || token !== catalogToken) return

      const isFirstPage = catalogStart === 0
      catalogGames = catalogGames.concat(items)
      catalogStart += rawItems.length
      catalogTotal = Math.max(Number(page?.total) || 0, catalogStart)
      catalogHasMore = !!page?.hasMore && rawItems.length > 0 && items.length > 0
      if (count) count.textContent = catalogGames.length + ' из ' + catalogTotal + ' · ' + regionLabel(requestRegion)

      if (isFirstPage) {
        target.innerHTML = items.length
          ? '<div class="steam-catalog-grid" id="steam-grid"></div>'
          : '<div class="empty"><h3>Игры не найдены</h3><p>Попробуйте другое название или выберите подборку выше.</p></div>'
      }
      const grid = U.$('#steam-grid', target)
      if (grid && items.length) {
        await appendCatalogCardsChunked(grid, items, token)
      }
      if (token !== catalogToken) return
      updateCatalogMore(view)
    } catch (err) {
      if (reset) {
        target.innerHTML = '<div class="empty"><h3>Не удалось загрузить каталог Steam</h3><p>' + U.esc(err.message || String(err)) + '</p></div>'
      } else if (more) {
        more.innerHTML = '<div class="card pad small muted">Не удалось загрузить следующую страницу. <button class="btn sm" id="steam-retry-more">Повторить</button></div>'
        U.$('#steam-retry-more', more)?.addEventListener('click', () => loadCatalogResults(view, { reset: false }))
      }
    } finally {
      catalogLoading = false
      if (token === catalogToken) {
        updateCatalogMore(view)
      } else if (catalogPendingReset) {
        catalogPendingReset = false
        if (target.isConnected && location.hash === '#/catalog') loadCatalogResults(view, { reset: false })
      }
    }
  }

  function appendCatalogCardsChunked(grid, items, token) {
    const CHUNK = 8
    let offset = 0
    return new Promise((resolve) => {
      const mountNext = () => {
        if (!grid.isConnected || token !== catalogToken || offset >= items.length) {
          resolve()
          return
        }
        const slice = items.slice(offset, offset + CHUNK)
        offset += CHUNK
        const fragment = document.createDocumentFragment()
        const holder = document.createElement('div')
        holder.innerHTML = slice.map((game) => steamResultCard(game)).join('')
        while (holder.firstElementChild) fragment.appendChild(holder.firstElementChild)
        bindCatalogScreenshots(fragment)
        bindReviewInspectors(fragment, slice)
        grid.appendChild(fragment)
        if (offset < items.length) requestAnimationFrame(mountNext)
        else resolve()
      }
      mountNext()
    })
  }

  function updateCatalogMore(view) {
    const more = U.$('#steam-more', view)
    if (!more || !more.isConnected) return
    if (catalogLoading) {
      more.innerHTML = '<div class="card pad small muted">Загружаем ещё игры…</div>'
      return
    }
    if (catalogHasMore) {
      more.innerHTML = '<div class="catalog-more-inner"><div id="steam-sentinel" aria-hidden="true"></div>' +
        '<button class="btn" id="steam-load-more">Показать ещё ' + CATALOG_PAGE_SIZE + '</button>' +
        '<span class="tiny dim">Загружено ' + catalogGames.length + ' из ' + catalogTotal + '</span></div>'
      U.$('#steam-load-more', more)?.addEventListener('click', () => loadCatalogResults(view, { reset: false }))
      const sentinel = U.$('#steam-sentinel', more)
      if (sentinel) {
        if (catalogObserver) catalogObserver.disconnect()
        catalogObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            catalogObserver?.disconnect()
            catalogObserver = null
            loadCatalogResults(view, { reset: false })
          }
        }, { rootMargin: '300px 0px' })
        catalogObserver.observe(sentinel)
      }
    } else if (catalogGames.length) {
      more.innerHTML = '<div class="tiny dim" style="text-align:center;padding:12px">Показаны все ' + catalogGames.length + ' ' +
        U.plural(catalogGames.length, 'игра', 'игры', 'игр') + ' по этому запросу</div>'
    } else {
      more.innerHTML = ''
    }
  }

  function steamResultCard(game) {
    const image = safeSteamImage(game.headerImage || game.image)
    const genres = Array.isArray(game.genres) ? game.genres.slice(0, 4) : []
    const tags = Array.isArray(game.tags) ? game.tags.slice(0, 4) : []
    const shots = Array.isArray(game.screenshots) ? game.screenshots.slice(0, 3) : []
    const metaScore = game.metacritic?.score
    const comm = game.community || null
    const commReviews = Array.isArray(comm?.reviews) ? comm.reviews.slice(0, 3) : []
    const dev = Array.isArray(game.developers) && game.developers.length ? game.developers[0] : ''
    const priceLabel = game.priceText || (game.regionAvailable === false
      ? 'Нет в регионе'
      : game.price != null ? formatPrice(game.price, game.currency) : '')
    const priceUnavailable = !game.priceText && game.regionAvailable === false

    return '<article class="card steam-catalog-card" data-steam-card="' + game.steamAppId + '" data-route="#/steam/' + game.steamAppId + '" style="cursor:pointer">' +
      '<div class="steam-card-media">' +
        (image ? '<img src="' + U.attr(image) + '" alt="" loading="lazy" decoding="async" class="steam-card-cover">' : '<div class="steam-placeholder">STEAM</div>') +
        '<div class="steam-card-badges">' +
          (comm?.count > 0 ? '<span class="ach-pill" title="Средняя оценка участников Критериума">★ Критериум ' + U.formatNumber(comm.average) + ' (' + comm.count + ')</span>' : '') +
          (metaScore ? '<span class="chip good" title="Оценка Metacritic">MC ' + metaScore + '</span>' : '') +
          (game.discountPercent > 0 ? '<span class="chip accent">−' + game.discountPercent + '%</span>' : '') +
          (priceLabel ? '<span class="chip' + (priceUnavailable ? ' bad' : '') + '" title="' + U.attr(priceUnavailable ? 'Игра недоступна в выбранном регионе Steam' : 'Цена в Steam, регион ' + catalogRegion) + '">' + U.esc(priceLabel) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="steam-card-body">' +
        '<div class="row"><h3 class="steam-card-title">' + U.esc(game.title) + '</h3></div>' +
        '<div class="tiny dim">' +
          U.esc([dev, game.releaseDate, game.steamRecommendationCount ? U.formatNumber(game.steamRecommendationCount, 0) + ' отзывов Steam' : 'ID ' + game.steamAppId].filter(Boolean).join(' · ')) +
        '</div>' +
        (game.description ? '<p class="steam-card-desc">' + U.esc(game.description) + '</p>' : '') +
        (genres.length ? '<div class="row wrap" style="gap:5px;margin-top:8px">' + genres.map((g) => '<span class="chip accent">' + U.esc(g) + '</span>').join('') + '</div>' : '') +
        (tags.length ? '<div class="row wrap" style="gap:5px;margin-top:5px">' + tags.map((t) => '<span class="chip">' + U.esc(t) + '</span>').join('') + '</div>' : '') +
        (shots.length ? '<div class="steam-card-shots">' + shots.map((s, idx) => {
          const thumb = safeSteamImage(s.thumb)
          const full = safeSteamImage(s.full || s.thumb)
          return thumb ? '<img src="' + U.attr(thumb) + '" data-shot-full="' + U.attr(full) + '" data-shot-title="' + U.attr(game.title + ' — скриншот ' + (idx + 1)) + '" alt="" loading="lazy" decoding="async" title="Нажмите, чтобы увеличить скриншот">' : ''
        }).join('') + '</div>' : '') +
        (commReviews.length ? '<div class="card-comm-reviews">' +
          '<div class="tiny dim" style="margin-bottom:4px">Оценки участников (' + comm.count + '):</div>' +
          commReviews.map((rev) => {
            const p = rev.profile || {}
            return '<div class="card-comm-row" data-inspect-review="' + U.attr(rev.id) + '" data-inspect-game="' + U.attr(game.title) + '" title="Нажмите, чтобы открыть полный разбор">' +
              '<span class="tiny">' + U.esc((p.avatar || '🎮') + ' ' + (p.display_name || p.handle || 'Участник')) + '</span>' +
              (rev.verdict ? '<span class="tiny dim ellipsis" style="flex:1">' + U.esc(rev.verdict) + '</span>' : '<span class="spacer"></span>') +
              '<b class="tiny mono" style="color:' + U.scoreColor(rev.score) + '">' + U.formatNumber(rev.score) + '</b></div>'
          }).join('') + '</div>' : '') +
        '<div class="row wrap" style="gap:8px;margin-top:auto;padding-top:12px">' +
          '<button class="btn sm" data-route="#/steam/' + game.steamAppId + '">Страница игры' + (comm?.count ? ' (' + comm.count + ')' : '') + '</button>' +
          '<button class="btn sm primary" data-route="#/review/' + game.steamAppId + '">Оценить</button>' +
          '<span class="spacer"></span>' +
          '<span class="tiny dim">#' + game.steamAppId + '</span>' +
        '</div>' +
      '</div></article>'
  }

  const CHEVRON_PREV_SVG = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12.2 4.5 6.8 10l5.4 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const CHEVRON_NEXT_SVG = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7.8 4.5 13.2 10l-5.4 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  function openScreenshotLightbox(shots, startIndex, gameTitle) {
    if (!Array.isArray(shots) || !shots.length) return
    let idx = Math.max(0, Math.min(shots.length - 1, Number(startIndex) || 0))
    const body =
      '<div class="shot-lightbox">' +
        '<div class="shot-lightbox-stage">' +
          '<img id="lb-img" src="' + U.attr(shots[idx].full || shots[idx].thumb) + '" alt="" decoding="async">' +
          (shots.length > 1
            ? '<button type="button" class="shot-nav prev" id="lb-prev" title="Предыдущий скриншот (←)" aria-label="Предыдущий">' + CHEVRON_PREV_SVG + '</button>' +
              '<button type="button" class="shot-nav next" id="lb-next" title="Следующий скриншот (→)" aria-label="Следующий">' + CHEVRON_NEXT_SVG + '</button>'
            : '') +
          '<div class="shot-counter" id="lb-counter">' + (idx + 1) + ' / ' + shots.length + '</div>' +
        '</div>' +
        (shots.length > 1 ? '<div class="shot-lightbox-thumbs" id="lb-thumbs">' +
          shots.map((s, i) =>
            '<button type="button" class="steam-shot-thumb' + (i === idx ? ' active' : '') + '" data-lb-idx="' + i + '">' +
            '<img src="' + U.attr(s.thumb || s.full) + '" alt="" decoding="async"></button>'
          ).join('') + '</div>' : '') +
      '</div>'

    U.openModal({
      title: (gameTitle || 'Скриншот') + ' — скриншоты',
      width: 1060,
      body,
      onMount({ root }) {
        const imgEl = U.$('#lb-img', root)
        const counterEl = U.$('#lb-counter', root)
        const setIdx = (nextIdx) => {
          idx = (nextIdx + shots.length) % shots.length
          if (imgEl) imgEl.src = shots[idx].full || shots[idx].thumb
          if (counterEl) counterEl.textContent = (idx + 1) + ' / ' + shots.length
          U.$$('[data-lb-idx]', root).forEach((b) => {
            const active = Number(b.dataset.lbIdx) === idx
            b.classList.toggle('active', active)
            if (active) b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          })
        }
        U.$('#lb-prev', root)?.addEventListener('click', (e) => { e.stopPropagation(); setIdx(idx - 1) })
        U.$('#lb-next', root)?.addEventListener('click', (e) => { e.stopPropagation(); setIdx(idx + 1) })
        U.$$('[data-lb-idx]', root).forEach((b) => b.addEventListener('click', () => setIdx(Number(b.dataset.lbIdx))))

        const onKey = (e) => {
          if (!root.isConnected) {
            document.removeEventListener('keydown', onKey)
            return
          }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx(idx - 1) }
          else if (e.key === 'ArrowRight') { e.preventDefault(); setIdx(idx + 1) }
        }
        document.addEventListener('keydown', onKey)
        const obs = new MutationObserver(() => {
          if (!root.isConnected) {
            document.removeEventListener('keydown', onKey)
            obs.disconnect()
          }
        })
        obs.observe(document.body, { childList: true, subtree: true })
      }
    })
  }

  function bindCatalogScreenshots(container) {
    U.$$('[data-shot-full]', container).forEach((img) => {
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        const card = img.closest('.steam-catalog-card')
        const siblings = card ? U.$$('[data-shot-full]', card) : [img]
        const shots = siblings.map((el) => ({ thumb: el.src, full: el.dataset.shotFull || el.src }))
        const startIdx = Math.max(0, siblings.indexOf(img))
        const title = (img.dataset.shotTitle || 'Скриншот').replace(/\s*—\s*скриншот\s*\d+$/i, '')
        openScreenshotLightbox(shots, startIdx, title)
      })
    })
  }

  function safeSteamImage(value) {
    try {
      const url = new URL(String(value || ''))
      return url.protocol === 'https:' && /(^|\.)(steamstatic\.com|akamaihd\.net)$/.test(url.hostname.split('.').slice(-2).join('.')) ? url.href : ''
    } catch { return '' }
  }

  /* ---------- canonical game page ---------- */

  async function renderSteamGame(view, steamAppId) {
    const id = Number(steamAppId)
    if (!Number.isSafeInteger(id) || id <= 0) {
      view.innerHTML = shell(head('Каталог', 'Некорректная ссылка', 'У игры должен быть действительный Steam App ID.') + '<button class="btn" data-route="#/catalog">Вернуться в каталог</button>')
      return
    }
    view.innerHTML = shell('<div class="card pad">Загружаем страницу игры…</div>')
    try {
      const [steam, status] = await Promise.all([
        api.cloud.steamDetails(id),
        getStatus()
      ])
      let shared = null
      let sharedError = ''
      if (status.configured) {
        try { shared = await api.cloud.publicGame(id) } catch (err) { sharedError = err.message || String(err) }
      }
      if (!view.isConnected || location.hash !== '#/steam/' + id) return
      view.innerHTML = shell(steamGameHtml(steam, null, status, shared, sharedError))
      view.scrollTop = 0
      bindSteamGame(view, steam, null, status, shared)
      api.cloud.steamReviews(id).then((reviews) => {
        if (!view.isConnected || location.hash !== '#/steam/' + id) return
        updateSteamReviewStat(view, reviews, steam.steamRecommendationCount)
      }).catch(() => {
        if (!view.isConnected || location.hash !== '#/steam/' + id) return
        updateSteamReviewStat(view, null, steam.steamRecommendationCount)
      })
    } catch (err) {
      view.innerHTML = shell(head('Каталог', 'Не удалось загрузить игру', err.message || String(err)) +
        '<button class="btn" data-route="#/catalog">Вернуться к поиску</button>')
    }
  }

  function steamGameHtml(steam, steamReviews, status, shared, sharedError) {
    const game = shared?.game || null
    const meta = shared?.externalRatings?.find((x) => x.source === 'metacritic')
    const metacriticScore = meta?.score ?? steam.metacritic?.score
    const userRating = shared?.externalRatings?.find((x) => x.source === 'steam')
    const otherRatings = (shared?.externalRatings || []).filter((x) => !['steam', 'metacritic'].includes(x.source))
    const internalRows = Array.isArray(shared?.community) ? shared.community : []
    const internal = internalRows[0] || null
    const heroImage = safeSteamImage(steam.headerImage)
    const tags = Array.isArray(steam.tags) ? steam.tags : []
    const shots = (Array.isArray(steam.screenshots) ? steam.screenshots : [])
      .map((s) => ({ thumb: safeSteamImage(s.thumb), full: safeSteamImage(s.full || s.thumb) }))
      .filter((s) => s.thumb)

    let html = '<div class="row wrap" style="margin-bottom:14px"><button class="btn ghost sm" data-route="#/catalog">' + U.icon('back', 14) + ' Каталог игр</button>' +
      '<span class="spacer"></span>' +
      (status.signedIn
        ? '<button class="btn primary sm" data-route="#/review/' + steam.steamAppId + '">' + U.icon('plus', 14) + ' Оценить эту игру</button>'
        : '<button class="btn primary sm" data-route="#/account">Войдите, чтобы оставить оценку</button>') +
      '<button class="btn ghost sm" id="open-steam">Открыть в Steam</button></div>'

    html += '<div class="card steam-hero">' + (heroImage ? '<img src="' + U.attr(heroImage) + '" alt="" class="steam-hero-image">' : '') +
      '<div class="steam-hero-content"><div class="eyebrow">Steam App ID ' + steam.steamAppId + (steam.releaseDate ? ' · ' + U.esc(steam.releaseDate) : '') +
      (steam.priceText ? ' · ' + U.esc(steam.priceText) : steam.regionAvailable === false ? ' · нет в продаже в регионе ' + U.esc(String(steam.region || '').toUpperCase()) : '') + '</div>' +
      '<h1>' + U.esc(steam.title) + '</h1><p>' + U.esc(steam.description || 'Описание пока не добавлено.') + '</p>' +
      '<div class="row wrap" style="margin-top:12px">' +
      (steam.genres || []).map((g) => '<span class="chip accent">' + U.esc(g) + '</span>').join('') +
      tags.slice(0, 6).map((t) => '<span class="chip">' + U.esc(t) + '</span>').join('') +
      '</div></div></div>'

    html += '<div class="stats" style="margin-top:14px">' +
      scoreStat('Metacritic', metacriticScore == null ? 'Нет данных' : String(metacriticScore) + ' / 100', meta?.vote_count ? meta.vote_count + ' голосов' : steam.metacritic ? 'по данным Steam' : 'оценка не найдена') +
      scoreStat('Игроки Steam', steamReviews?.percentPositive != null
        ? U.formatNumber(steamReviews.percentPositive) + '% положительных'
        : userRating ? U.formatNumber(userRating.score) + ' / 100'
          : steamReviews ? 'Нет данных'
            : steam.steamRecommendationCount ? U.formatNumber(steam.steamRecommendationCount, 0) + ' отзывов'
              : 'Загружаем…',
      steamReviews ? U.formatNumber(steamReviews.total, 0) + ' отзывов' : steam.steamRecommendationCount ? 'в Steam · доля рекомендаций недоступна' : 'загружаем оценки Steam', 'steam-reviews') +
      scoreStat('Критериум', internal?.average_score == null ? 'Пока нет оценок' : U.formatNumber(internal.average_score) + ' / 100', internal ? internal.review_count + ' оценок · жанр «' + internal.genre_id + '»' : 'оценки участников') +
      scoreStat('Статус страницы', game ? 'В общем каталоге' : 'Готова к оценке', game ? 'отзывы участников привязаны к игре' : 'страница создастся при первой оценке') +
      '</div>'

    if (internalRows.length > 1) {
      html += '<div class="row wrap" style="gap:7px;margin-top:10px"><span class="tiny dim">Средние оценки по жанрам:</span>' +
        internalRows.map((row) => '<span class="chip">' + U.esc(row.genre_id) + ' · ' + U.formatNumber(row.average_score) + ' (' + row.review_count + ')</span>').join('') + '</div>'
    }
    if (sharedError) html += '<div class="tiny dim" style="margin:10px 0">Общие оценки временно недоступны: ' + U.esc(sharedError) + '</div>'

    if (shots.length) {
      html += '<div class="card pad" style="margin-top:16px">' +
        cardTitle('Скриншоты из Steam', 'Листайте стрелками на кадре, клавишами ← → или нажмите на кадр для полноэкранного просмотра') +
        '<div class="steam-gallery">' +
          '<div class="steam-gallery-main">' +
            '<img id="steam-main-shot" src="' + U.attr(shots[0].full) + '" alt="" data-idx="0" data-full="' + U.attr(shots[0].full) + '">' +
            (shots.length > 1
              ? '<button type="button" class="shot-nav prev" id="steam-shot-prev" title="Предыдущий скриншот (←)" aria-label="Предыдущий">' + CHEVRON_PREV_SVG + '</button>' +
                '<button type="button" class="shot-nav next" id="steam-shot-next" title="Следующий скриншот (→)" aria-label="Следующий">' + CHEVRON_NEXT_SVG + '</button>' +
                '<div class="shot-counter" id="steam-shot-counter">1 / ' + shots.length + '</div>'
              : '') +
          '</div>' +
          '<div class="steam-gallery-strip">' +
            shots.map((s, idx) =>
              '<button type="button" class="steam-shot-thumb' + (idx === 0 ? ' active' : '') + '" data-shot-idx="' + idx + '" data-shot-src="' + U.attr(s.full) + '">' +
              '<img src="' + U.attr(s.thumb) + '" alt="" loading="lazy"></button>'
            ).join('') +
          '</div>' +
        '</div></div>'
    }

    html += '<div class="two-col" style="margin-top:16px;align-items:start"><div class="card pad">' +
      cardTitle('Оценки участников', 'Публичные отзывы людей, которые оценивали эту игру.')
    if (!shared?.reviews?.length) {
      html += '<div class="empty"><h3>Оценок пока нет</h3><p>Станьте первым, кто оценит «' + U.esc(steam.title) + '» по критериям — ваша оценка сразу появится здесь.</p>' +
        (status.signedIn
          ? '<button class="btn primary sm" data-route="#/review/' + steam.steamAppId + '">Оценить эту игру</button>'
          : '<button class="btn primary sm" data-route="#/account">Войти и оценить</button>') +
        (status.signedIn && !game ? ' <button class="btn ghost sm" id="add-shared-game">Закрепить в каталоге</button>' : '') +
        '</div>'
    } else {
      html += '<div class="community-reviews">' + shared.reviews.map((review) => reviewCard(review)).join('') + '</div>'
    }
    html += '</div><div class="card pad">' + cardTitle('Об игре и теги Steam', 'Информация из Steam Store') +
      '<div class="small muted" style="line-height:1.7">' +
      '<b>Разработчик:</b> ' + U.esc((steam.developers || []).join(', ') || 'не указан') +
      '<br><b>Издатель:</b> ' + U.esc((steam.publishers || []).join(', ') || 'не указан') +
      '<br><b>Платформы:</b> ' + U.esc((steam.platforms || []).join(' · ') || 'не указаны') +
      (steam.releaseDate ? '<br><b>Дата выхода:</b> ' + U.esc(steam.releaseDate) : '') +
      (steam.priceText ? '<br><b>Цена в Steam:</b> ' + U.esc(steam.priceText) : steam.regionAvailable === false ? '<br><b>Цена в Steam:</b> <span class="dim">не продаётся в выбранном регионе</span>' : '') +
      '</div>' +
      (steam.genres?.length ? '<div class="divider"></div><div class="tiny dim" style="margin-bottom:6px">ЖАНРЫ</div><div class="row wrap" style="gap:5px">' +
        steam.genres.map((g) => '<span class="chip accent">' + U.esc(g) + '</span>').join('') + '</div>' : '') +
      (tags.length ? '<div class="divider"></div><div class="tiny dim" style="margin-bottom:6px">ОСОБЕННОСТИ И ТЕГИ STEAM</div><div class="row wrap" style="gap:5px">' +
        tags.map((t) => '<span class="chip">' + U.esc(t) + '</span>').join('') + '</div>' : '') +
      (steam.metacritic?.url ? '<div style="margin-top:12px"><button class="btn sm ghost" data-external="' + U.attr(steam.metacritic.url) + '">Открыть Metacritic</button></div>' : '') +
      (otherRatings.length ? '<div class="divider"></div><div class="small" style="font-weight:600;margin-bottom:8px">Другие оценки</div>' + otherRatings.map((rating) =>
        '<div class="row" style="padding:5px 0"><span class="small muted">' + U.esc(rating.source === 'opencritic' ? 'OpenCritic' : rating.source) + '</span><span class="spacer"></span><b>' + U.formatNumber(rating.score) + ' / ' + U.formatNumber(rating.max_score) + '</b>' +
        (rating.url ? '<button class="btn ghost sm" data-external="' + U.attr(rating.url) + '">Открыть</button>' : '') + '</div>').join('') : '') +
      (steam.supportedLanguages ? '<div class="divider"></div><div class="tiny dim" style="margin-bottom:4px">ЯЗЫКИ</div><div class="tiny muted" style="line-height:1.5">' + U.esc(steam.supportedLanguages) + '</div>' : '') +
      '<div class="divider"></div><p class="tiny dim">Оценка Metacritic показывается, если она указана в карточке игры Steam.</p></div></div>'

    if (steam.aboutText) {
      html += '<div class="card pad" style="margin-top:16px">' +
        cardTitle('Подробно об игре', 'Описание со страницы игры в Steam') +
        '<div class="small muted" style="white-space:pre-line;line-height:1.7;max-height:360px;overflow-y:auto;padding-right:6px">' +
        U.esc(steam.aboutText) + '</div></div>'
    }

    if (steam.pcMinimum || steam.pcRecommended) {
      html += '<div class="card pad" style="margin-top:16px">' +
        cardTitle('Системные требования (ПК)', 'Конфигурация по данным Steam') +
        '<div class="req-grid' + (steam.pcMinimum && steam.pcRecommended ? '' : ' single') + '">' +
        (steam.pcMinimum ? renderReqBlock('Минимальные', steam.pcMinimum) : '') +
        (steam.pcRecommended ? renderReqBlock('Рекомендованные', steam.pcRecommended) : '') +
        '</div></div>'
    }
    return html
  }

  function renderReqBlock(label, rawText) {
    const lines = String(rawText || '')
      .split('\n')
      .map((l) => l.replace(/^[•*\-\s]+/, '').trim())
      .filter(Boolean)
      .filter((l) => !/^(минимальные|рекомендованные|minimum|recommended)\s*:?$/i.test(l))

    const rows = []
    for (const line of lines) {
      const idx = line.indexOf(':')
      if (idx > 0 && idx < 42) {
        const key = line.slice(0, idx).replace(/\s*\*$/, '').trim()
        const val = line.slice(idx + 1).trim()
        if (val) {
          rows.push('<div class="req-row"><span class="req-key">' + U.esc(key) + '</span><span class="req-val">' + U.esc(val) + '</span></div>')
        }
      } else {
        rows.push('<div class="req-note">' + U.esc(line) + '</div>')
      }
    }
    return '<div class="req-col"><div class="req-head">' + U.esc(label) + '</div><div class="req-list">' + rows.join('') + '</div></div>'
  }

  function scoreStat(label, value, sub, key) {
    return '<div class="stat"' + (key ? ' data-stat="' + U.attr(key) + '"' : '') + '><div class="stat-label">' + U.esc(label) + '</div><div class="stat-value" data-stat-value style="font-size:20px;margin-top:5px">' + U.esc(value) + '</div><div class="stat-label" data-stat-sub>' + U.esc(sub) + '</div></div>'
  }

  function updateSteamReviewStat(view, reviews, fallbackCount) {
    const card = U.$('[data-stat="steam-reviews"]', view)
    if (!card) return
    const value = U.$('[data-stat-value]', card)
    const sub = U.$('[data-stat-sub]', card)
    if (!value || !sub) return
    if (reviews?.percentPositive != null) {
      value.textContent = U.formatNumber(reviews.percentPositive) + '% положительных'
      sub.textContent = U.formatNumber(reviews.total, 0) + ' отзывов'
    } else if (fallbackCount) {
      value.textContent = U.formatNumber(fallbackCount, 0) + ' отзывов'
      sub.textContent = 'в Steam · доля рекомендаций недоступна'
    } else {
      value.textContent = 'Нет данных'
      sub.textContent = 'Отзывы Steam сейчас недоступны'
    }
  }

  function openCommunityReviewModal(review, gameTitle) {
    if (!review) return
    const S = window.K.scoring
    const C = window.K.charts
    const profile = review.profile || {}
    const catalog = window.K.app.catalog(review.genre_id || null)
    const cells = review.criterion_ratings && typeof review.criterion_ratings === 'object' ? review.criterion_ratings : {}
    const computed = S.computeScore(catalog, cells)
    const total = Number(review.score) || computed.total || 0
    const grade = S.gradeFor(catalog, total)
    const genreLabel = window.K.app.genreName(review.genre_id || '')

    let html = '<div class="card pad" style="margin-bottom:14px">' +
      '<div class="row wrap" style="gap:14px;align-items:center">' +
        '<div class="mini-avatar" style="width:44px;height:44px;font-size:22px">' + U.esc(profile.avatar || '🎮') + '</div>' +
        '<div class="grow">' +
          '<div class="row wrap" style="gap:8px"><b>' + U.esc(profile.display_name || profile.handle || 'Участник') + '</b>' + badgePillsHtml(profile, false) + '</div>' +
          '<div class="tiny dim" style="margin-top:3px">Жанр: ' + U.esc(genreLabel) + ' · Заполнено: ' + Math.round((Number(review.coverage ?? computed.coverage) || 0) * 100) + '% · ' + U.esc(U.formatDate(review.updated_at)) + '</div>' +
        '</div>' +
        '<div>' + C.ring(total, { size: 96, stroke: 8, color: U.scoreColor(total), sublabel: grade ? grade.label : '' }) + '</div>' +
      '</div>' +
      (review.verdict ? '<div class="divider"></div><div style="font-size:13px;line-height:1.6">' + U.esc(review.verdict) + '</div>' : '') +
      '</div>'

    if (review.pros || review.cons) {
      html += '<div class="notes-grid" style="margin-top:0;margin-bottom:14px">' +
        (review.pros ? '<div class="card note-card good"><h4>Сильные стороны</h4><div class="text">' + U.esc(review.pros) + '</div></div>' : '') +
        (review.cons ? '<div class="card note-card bad"><h4>Слабые стороны</h4><div class="text">' + U.esc(review.cons) + '</div></div>' : '') +
        '</div>'
    }

    if (computed.rated > 0) {
      html += '<div class="tier-cards" style="margin-bottom:14px">' +
        computed.tiers.map((t) =>
          '<div class="card tier-card"><div class="t-name">' + U.esc(t.name) + ' · ' + t.points + '</div>' +
          '<div class="t-value">' + U.formatNumber(t.earned) + '<small> / ' + t.points + '</small></div>' +
          '<div class="bar"><i style="width:' + (t.points ? (t.earned / t.points) * 100 : 0) + '%;background:' + U.scoreColor((t.earned / t.points) * 100) + '"></i></div>' +
          '<div class="tiny dim" style="margin-top:6px">' + t.rated + ' из ' + t.applicable + ' критериев</div></div>'
        ).join('') + '</div>'

      html += '<div class="card" style="padding:14px 16px 6px"><table class="cat-table"><thead><tr>' +
        '<th>Категория</th><th class="num">Вес</th><th class="num">Балл</th><th>Шкала</th><th class="num">Вклад</th></tr></thead><tbody>'
      for (const tier of catalog.tiers) {
        const cats = computed.categories.filter((c) => c.tier === tier.id && c.score != null)
        if (!cats.length) continue
        html += '<tr><td colspan="5" style="padding-top:12px"><div class="eyebrow" style="margin:0">' + U.esc(tier.name) + ' · ' + tier.points + ' баллов</div></td></tr>'
        for (const cat of cats) {
          const shown = Math.round(cat.score * 10) / 10
          html += '<tr><td>' + U.esc(cat.name) + '</td>' +
            '<td class="num dim">' + U.formatNumber(cat.points, 1) + '</td>' +
            '<td class="num cat-score" style="color:' + U.scoreColor(cat.score * 10) + '">' + U.formatNumber(shown) + '<span class="dim tiny">/10</span></td>' +
            '<td><div class="bar"><i style="width:' + (cat.score * 10) + '%;background:' + U.scoreColor(cat.score * 10) + '"></i></div></td>' +
            '<td class="num">' + U.formatNumber(cat.earned, 1) + '</td></tr>'
        }
      }
      html += '</tbody></table></div>'
    }

    U.openModal({
      title: (gameTitle || 'Игра') + ' — оценка ' + (profile.display_name || profile.handle || 'участника'),
      width: 820,
      body: html
    })
  }

  function bindReviewInspectors(container, gamesList) {
    const byId = new Map()
    for (const g of gamesList || []) {
      for (const r of g?.community?.reviews || []) {
        byId.set(String(r.id), { review: r, title: g.title })
      }
    }
    U.$$('[data-inspect-review]', container).forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const found = byId.get(String(el.dataset.inspectReview))
        if (found) openCommunityReviewModal(found.review, found.title)
      })
    })
  }

  function reviewCard(review) {
    const profile = review.profile || {}
    const genreLabel = window.K.app.genreName(review.genre_id || '')
    return '<article class="community-review" data-open-review="' + U.attr(review.id) + '" style="cursor:pointer" title="Нажмите, чтобы посмотреть полный разбор по категориям">' +
      '<div class="row wrap"><span class="mini-avatar">' + U.esc(profile.avatar || '🎮') + '</span>' +
      '<button class="text-link" data-route="#/person/' + U.attr(profile.handle || '') + '">' + U.esc(profile.display_name || profile.handle || 'Участник') + '</button>' +
      badgePillsHtml(profile, false) +
      '<span class="chip">' + U.esc(genreLabel || 'Жанр не указан') + '</span>' +
      '<span class="spacer"></span><b class="review-score" style="color:' + U.scoreColor(review.score) + '">' + U.formatNumber(review.score) + ' / 100</b></div>' +
      (review.review_title ? '<h4 style="margin-top:9px">' + U.esc(review.review_title) + '</h4>' : '') +
      (review.verdict ? '<p class="small muted" style="margin-top:7px;line-height:1.6">' + U.esc(review.verdict) + '</p>' : '') +
      ((review.pros || review.cons) ? '<div class="row wrap" style="gap:10px;margin-top:8px">' +
        (review.pros ? '<span class="tiny" style="color:var(--good)">+ ' + U.esc(String(review.pros).split(/\r?\n/)[0]) + '</span>' : '') +
        (review.cons ? '<span class="tiny" style="color:var(--bad)">− ' + U.esc(String(review.cons).split(/\r?\n/)[0]) + '</span>' : '') +
        '</div>' : '') +
      '<div class="row wrap" style="margin-top:9px"><span class="tiny dim">Заполнено: ' + Math.round((review.coverage || 0) * 100) + '% · ' + U.esc(U.formatDate(review.updated_at)) + '</span>' +
      '<span class="spacer"></span><button type="button" class="btn ghost sm" data-open-review="' + U.attr(review.id) + '">Открыть полный разбор</button></div></article>'
  }

  function bindSteamGame(view, steam, steamReviews, status, shared) {
    U.$('#open-steam', view)?.addEventListener('click', () => api.openExternal(steam.storeUrl))
    U.$$('[data-external]', view).forEach((button) => button.addEventListener('click', () => api.openExternal(button.dataset.external)))
    U.$$('[data-open-review]', view).forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-route]')) return
        e.stopPropagation()
        const revId = el.dataset.openReview
        const rev = (shared?.reviews || []).find((r) => String(r.id) === String(revId))
        if (rev) openCommunityReviewModal(rev, steam.title)
      })
    })
    const shots = (Array.isArray(steam.screenshots) ? steam.screenshots : [])
      .map((s) => ({ thumb: safeSteamImage(s.thumb), full: safeSteamImage(s.full || s.thumb) }))
      .filter((s) => s.thumb)
    const mainShot = U.$('#steam-main-shot', view)
    const counterEl = U.$('#steam-shot-counter', view)
    let currentIdx = 0

    const selectShot = (nextIdx) => {
      if (!shots.length || !mainShot) return
      currentIdx = (nextIdx + shots.length) % shots.length
      const chosen = shots[currentIdx]
      mainShot.src = chosen.full
      mainShot.dataset.full = chosen.full
      mainShot.dataset.idx = String(currentIdx)
      if (counterEl) counterEl.textContent = (currentIdx + 1) + ' / ' + shots.length
      U.$$('[data-shot-idx]', view).forEach((b) => {
        const active = Number(b.dataset.shotIdx) === currentIdx
        b.classList.toggle('active', active)
        if (active) b.scrollIntoView({ block: 'nearest' })
      })
    }

    U.$$('[data-shot-idx]', view).forEach((btn) => {
      btn.addEventListener('click', () => selectShot(Number(btn.dataset.shotIdx) || 0))
    })
    U.$('#steam-shot-prev', view)?.addEventListener('click', (e) => {
      e.stopPropagation()
      selectShot(currentIdx - 1)
    })
    U.$('#steam-shot-next', view)?.addEventListener('click', (e) => {
      e.stopPropagation()
      selectShot(currentIdx + 1)
    })
    mainShot?.addEventListener('click', () => {
      openScreenshotLightbox(shots, currentIdx, steam.title)
    })

    if (shots.length > 1) {
      const onPageKey = (e) => {
        if (!view.isConnected || location.hash !== '#/steam/' + steam.steamAppId) {
          document.removeEventListener('keydown', onPageKey)
          return
        }
        if (document.querySelector('.modal-backdrop')) return
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
        if (e.key === 'ArrowLeft') { e.preventDefault(); selectShot(currentIdx - 1) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); selectShot(currentIdx + 1) }
      }
      document.addEventListener('keydown', onPageKey)
    }
    U.$('#add-shared-game', view)?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      button.textContent = 'Добавляем…'
      try {
        await api.cloud.addSteamGame(steam.steamAppId)
        U.toast('Страница игры добавлена в общий каталог', 'good')
        renderSteamGame(view, steam.steamAppId)
      } catch (err) {
        U.toast(err.message || 'Не удалось добавить игру', 'bad')
        button.disabled = false
        button.textContent = 'Закрепить в каталоге'
      }
    })
  }

  /* ---------- community profiles ---------- */

  async function renderCommunity(view) {
    const status = await getStatus()
    if (location.hash !== '#/community') return
    if (!status.configured) {
      view.innerHTML = shell(head('Сообщество', 'Участники', 'Публичные профили и их оценки.') + '<div class="card pad">Общая база пока не подключена. <button class="btn sm primary" data-route="#/account">Настроить</button></div>')
      return
    }
    view.innerHTML = shell(head('Сообщество', 'Участники', 'Ищите профили и смотрите публичные оценки.') +
      '<div class="tools"><label class="search">' + U.icon('search', 15) + '<input id="people-search" type="text" maxlength="40" placeholder="Имя или адрес профиля" value="' + U.attr(profileSearch) + '"></label>' +
      '<button class="btn" id="people-search-button">Найти</button></div><div id="people-list"><div class="card pad small muted">Загрузка участников…</div></div>')
    const input = U.$('#people-search', view)
    const run = async () => {
      profileSearch = input.value.trim()
      await listProfilesInto(view, profileSearch)
    }
    U.$('#people-search-button', view).addEventListener('click', run)
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') run() })
    run()
  }

  async function listProfilesInto(view, query) {
    const target = U.$('#people-list', view)
    if (!target) return
    target.innerHTML = '<div class="card pad small muted">Ищем…</div>'
    try {
      const profiles = await api.cloud.listProfiles(query)
      if (!target.isConnected || location.hash !== '#/community') return
      target.innerHTML = profiles.length ? '<div class="game-grid">' + profiles.map((profile) => profileCard(profile)).join('') + '</div>' :
        '<div class="empty"><h3>Профили не найдены</h3><p>Пока нет открытых профилей с таким именем.</p></div>'
    } catch (err) {
      target.innerHTML = '<div class="empty"><h3>Не удалось загрузить профили</h3><p>' + U.esc(err.message || String(err)) + '</p></div>'
    }
  }

  function profileCard(profile) {
    const pills = badgePillsHtml(profile, false)
    return '<button class="card person-card" data-route="#/person/' + U.attr(profile.handle) + '">' +
      '<span class="avatar-big">' + U.esc(profile.avatar || '🎮') + '</span><span class="person-card-info"><span class="row wrap" style="gap:6px"><b>' + U.esc(profile.display_name) + '</b>' + pills + '</span>' +
      '<small>@' + U.esc(profile.handle) + '</small><span>' + U.esc(profile.bio || 'О себе пока не написано.') + '</span></span>' + U.icon('arrow', 16) + '</button>'
  }

  async function renderPerson(view, handle) {
    view.innerHTML = shell('<div class="card pad">Загружаем профиль…</div>')
    try {
      const [result, status] = await Promise.all([
        api.cloud.publicProfile(handle),
        getStatus()
      ])
      const isDeveloper = status?.signedIn ? await api.cloud.isDeveloper().catch(() => false) : false
      if (!view.isConnected || location.hash !== '#/person/' + handle) return
      if (!result) {
        view.innerHTML = shell(head('Сообщество', 'Профиль не найден', 'Профиль может быть закрытым или адрес указан неверно.') + '<button class="btn" data-route="#/community">К участникам</button>')
        return
      }
      const p = result.profile
      const pills = badgePillsHtml(p, false)
      const list = badgeList(p, false)
      let html = '<div class="row wrap" style="margin-bottom:14px"><button class="btn ghost sm" data-route="#/community">' + U.icon('back', 14) + ' Участники</button>' +
        '<span class="spacer"></span>' +
        (isDeveloper ? '<button class="btn primary sm" id="dev-manage-badges">👑 Выдать / изменить награды</button>' : '') +
        '</div>' +
        '<div class="card profile-hero"><div class="avatar-big">' + U.esc(p.avatar || '🎮') + '</div><div class="grow"><h2>' + U.esc(p.display_name) + '</h2>' +
        '<div class="tagline">@' + U.esc(p.handle) + '</div><p class="small muted" style="margin-top:8px">' + U.esc(p.bio || 'О себе пока не написано.') + '</p>' +
        (pills ? '<div class="row wrap" style="margin-top:9px">' + pills + '</div>' : '') +
        '</div><span class="chip good">Открытый профиль</span></div>' +
        (list.length ? '<div class="subhead"><h3>Награды и достижения</h3><div class="line"></div><span class="tiny dim">' + list.length + '</span></div>' + badgeCardsHtml(p, false) : '') +
        '<div class="subhead"><h3>Оценки игр</h3><div class="line"></div><span class="tiny dim">' + result.reviews.length + '</span></div>'
      if (!result.reviews.length) html += '<div class="empty"><h3>Пока нет публичных оценок</h3><p>Когда владелец профиля опубликует оценку, она появится здесь.</p></div>'
      else html += '<div class="game-grid">' + result.reviews.map((r) => personReviewCard(r)).join('') + '</div>'
      view.innerHTML = shell(html)
      U.$('#dev-manage-badges', view)?.addEventListener('click', () => openBadgeManagerModal(p, () => renderPerson(view, handle)))
      U.$$('[data-person-review]', view).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const rev = result.reviews.find((r) => String(r.id) === String(btn.dataset.personReview))
          if (rev) openCommunityReviewModal(Object.assign({}, rev, { profile: p }), rev.game?.title || 'Игра')
        })
      })
    } catch (err) {
      view.innerHTML = shell(head('Сообщество', 'Не удалось загрузить профиль', err.message || String(err)) + '<button class="btn" data-route="#/community">К участникам</button>')
    }
  }

  function openBadgeManagerModal(targetProfile, onSaved) {
    const activeIds = new Set(badgeList(targetProfile, false).map((b) => b.id))
    const body =
      '<p class="small muted" style="margin-bottom:12px">Выберите награды для профиля <b>' + U.esc(targetProfile.display_name) + '</b> (@' + U.esc(targetProfile.handle) + '):</p>' +
      '<div style="display:flex;flex-direction:column;gap:9px">' +
      BADGE_CATALOG.map((b) => {
        const checked = activeIds.has(b.id)
        return '<label class="ach-card ' + U.attr(b.style) + '" style="cursor:pointer">' +
          '<input type="checkbox" data-badge-id="' + U.attr(b.id) + '"' + (checked ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--accent)">' +
          '<div class="ach-icon">' + badgeIconHtml(b) + '</div>' +
          '<div class="grow"><div class="ach-title">' + U.esc(b.title) + '</div><div class="ach-desc">' + U.esc(b.description) + '</div></div>' +
        '</label>'
      }).join('') +
      '</div>'

    U.openModal({
      title: 'Выдать награды · ' + targetProfile.display_name,
      width: 600,
      body,
      footer: '<button class="btn ghost" data-cancel>Отмена</button><button class="btn primary" data-save>Сохранить награды</button>',
      onMount({ root, close }) {
        U.$('[data-cancel]', root)?.addEventListener('click', close)
        U.$('[data-save]', root)?.addEventListener('click', async (e) => {
          const btn = e.currentTarget
          btn.disabled = true
          btn.textContent = 'Сохраняем…'
          const chosen = U.$$('[data-badge-id]', root)
            .filter((cb) => cb.checked)
            .map((cb) => BADGE_CATALOG.find((x) => x.id === cb.dataset.badgeId))
            .filter(Boolean)
            .map((b) => ({
              id: b.id,
              title: b.title,
              description: b.description,
              icon: b.icon,
              style: b.style,
              granted_at: new Date().toISOString()
            }))
          try {
            await api.cloud.setProfileBadges(targetProfile.handle, chosen)
            close()
            U.toast('Награды профиля обновлены', 'good')
            if (typeof onSaved === 'function') onSaved()
          } catch (err) {
            U.toast(err.message || 'Не удалось обновить награды', 'bad')
            btn.disabled = false
            btn.textContent = 'Сохранить награды'
          }
        })
      }
    })
  }

  function personReviewCard(review) {
    const game = review.game || {}
    return '<div class="card person-review-card" data-person-review="' + U.attr(review.id) + '" title="Нажмите, чтобы посмотреть полный разбор">' +
      (safeSteamImage(game.header_image) ? '<img src="' + U.attr(safeSteamImage(game.header_image)) + '" alt="" loading="lazy">' : '') +
      '<span class="grow"><b>' + U.esc(game.title || 'Игра') + '</b><small>' + U.esc(window.K.app.genreName(review.genre_id || '')) + '</small>' +
      (review.verdict ? '<span>' + U.esc(review.verdict) + '</span>' : '') +
      '<span class="row wrap" style="gap:6px;margin-top:4px"><button type="button" class="btn ghost sm" data-person-review="' + U.attr(review.id) + '">Разбор</button>' +
      (game.steam_app_id ? '<button type="button" class="btn ghost sm" data-route="#/steam/' + Number(game.steam_app_id) + '">Страница игры</button>' : '') + '</span></span>' +
      '<strong style="color:' + U.scoreColor(review.score) + '">' + U.formatNumber(review.score) + '</strong></div>'
  }

  window.K.Social = {
    renderAccount,
    renderCatalog,
    renderSteamGame,
    renderCommunity,
    renderPerson
  }
})()
