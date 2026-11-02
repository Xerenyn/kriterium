'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const PROFILE_FIELDS = 'id,handle,display_name,bio,avatar,is_public,badges,created_at'
const APP_USER_AGENT = 'Kriterium/1.0 (Windows desktop app)'
const DEFAULT_SUPABASE_URL = 'https://fubyxivjqtnmzpwinzge.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Ynl4aXZqcXRubXpwd2luemdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NDQ5MTgsImV4cCI6MjEwOTEyMDkxOH0.0_ZMAOqk0mMVIR4g7AnWCSR4oUMwbHPDl0LwdjvdVrE'

function safeError(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  const message = payload.msg || payload.message || payload.error_description || payload.error
  return typeof message === 'string' ? message.slice(0, 500) : fallback
}

function normalizeBaseUrl(value, allowLocal) {
  let parsed
  try { parsed = new URL(String(value || '').trim()) } catch { throw new Error('Введите корректный адрес Supabase.') }
  const isLocal = allowLocal && ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.port === '54321'
  if (parsed.protocol !== 'https:' && !isLocal) throw new Error('Для Supabase нужен HTTPS-адрес.')
  if (!isLocal && !parsed.hostname.endsWith('.supabase.co')) {
    throw new Error('Адрес должен быть вида https://ваш-проект.supabase.co.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('Укажите только адрес проекта, без пути, логина и параметров.')
  }
  return parsed.origin
}

function createCloud(configPath, safeStorage, options = {}) {
  const defaultUrl = options.disableDefaultConfig ? '' : DEFAULT_SUPABASE_URL
  const defaultAnonKey = options.disableDefaultConfig ? '' : DEFAULT_SUPABASE_ANON_KEY
  let config = { url: defaultUrl, anonKey: defaultAnonKey, encryptedSession: '' }
  let session = null
  const steamDetailsCache = new Map()
  let featuredCache = { ts: 0, data: null }
  const CURATED_GAMES = [
    { steamAppId: 1086940, title: "Baldur's Gate 3" },
    { steamAppId: 1245620, title: 'ELDEN RING' },
    { steamAppId: 1145350, title: 'Hades II' },
    { steamAppId: 1145360, title: 'Hades' },
    { steamAppId: 632470, title: 'Disco Elysium - The Final Cut' },
    { steamAppId: 1091500, title: 'Cyberpunk 2077' },
    { steamAppId: 367520, title: 'Hollow Knight' },
    { steamAppId: 292030, title: 'Ведьмак 3: Дикая Охота' },
    { steamAppId: 646570, title: 'Slay the Spire' },
    { steamAppId: 427520, title: 'Factorio' },
    { steamAppId: 504230, title: 'Celeste' },
    { steamAppId: 1174180, title: 'Red Dead Redemption 2' }
  ]
  let loaded = false
  let writeQueue = Promise.resolve()

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
      config.url = typeof parsed.url === 'string' && parsed.url ? parsed.url : defaultUrl
      config.anonKey = typeof parsed.anonKey === 'string' && parsed.anonKey ? parsed.anonKey : defaultAnonKey
      config.encryptedSession = typeof parsed.encryptedSession === 'string' ? parsed.encryptedSession : ''
      if (config.encryptedSession && safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
          const bytes = Buffer.from(config.encryptedSession, 'base64')
          session = JSON.parse(safeStorage.decryptString(bytes))
        } catch {
          session = null
          config.encryptedSession = ''
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  async function persist() {
    const snapshot = {
      url: config.url,
      anonKey: config.anonKey,
      encryptedSession: config.encryptedSession
    }
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(configPath), { recursive: true })
      const temp = configPath + '.tmp'
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8')
      await fs.rename(temp, configPath)
    })
    return writeQueue
  }

  function configured() {
    return !!(config.url && config.anonKey)
  }

  function publicStatus() {
    return {
      configured: configured(),
      url: config.url,
      signedIn: !!(session && session.access_token && session.user),
      user: session && session.user ? {
        id: session.user.id,
        email: session.user.email || ''
      } : null,
      encryptionAvailable: !!(safeStorage && safeStorage.isEncryptionAvailable())
    }
  }

  async function request(pathname, options = {}, token) {
    if (!configured()) throw new Error('Сначала укажите URL и anon key проекта Supabase в настройках.')
    const headers = new Headers(options.headers || {})
    headers.set('apikey', config.anonKey)
    headers.set('accept', 'application/json')
    headers.set('user-agent', APP_USER_AGENT)
    if (token !== false && (token || session?.access_token)) headers.set('authorization', 'Bearer ' + (token || session.access_token))
    if (options.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json')

    let response
    try {
      response = await fetch(config.url + pathname, {
        ...options,
        headers,
        signal: AbortSignal.timeout(15000)
      })
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд.')
      throw new Error('Не удалось подключиться. Проверьте интернет и настройки Supabase.')
    }

    const text = await response.text()
    let result = null
    if (text) {
      try { result = JSON.parse(text) } catch { result = { message: text.slice(0, 500) } }
    }
    if (!response.ok) {
      const fallback = 'Ошибка Supabase (' + response.status + ').'
      throw new Error(safeError(result, fallback))
    }
    return result
  }

  function sessionWithExpiry(value) {
    if (!value || !value.access_token || !value.refresh_token || !value.user) return null
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at) || Math.floor(Date.now() / 1000) + (Number(value.expires_in) || 3600),
      user: value.user
    }
  }

  async function persistSession(value) {
    session = sessionWithExpiry(value)
    if (session) {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        session = null
        config.encryptedSession = ''
        await persist()
        throw new Error('Windows не смогла зашифровать вход. Проверьте настройки защиты устройства.')
      }
      config.encryptedSession = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
    } else {
      config.encryptedSession = ''
    }
    await persist()
    return session
  }

  async function refreshSession() {
    await load()
    if (!session || !session.refresh_token) return null
    if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session
    try {
      const data = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }, false)
      return await persistSession(data)
    } catch (err) {
      if (/401|invalid.*refresh|refresh token.*(expired|invalid|not found)|session.*(expired|not found)/i.test(err.message || '')) {
        session = null
        config.encryptedSession = ''
        await persist()
        return null
      }
      throw err
    }
  }

  async function ensureSession() {
    await load()
    const current = await refreshSession()
    if (!current) throw new Error('Войдите в аккаунт, чтобы продолжить.')
    return current
  }

  async function rest(pathname, options = {}) {
    await refreshSession()
    return request('/rest/v1/' + pathname, options)
  }

  return {
    async status() {
      await load()
      try { await refreshSession() } catch { /* preserve encrypted session while offline */ }
      return publicStatus()
    },

    async configure(input = {}) {
      await load()
      const url = normalizeBaseUrl(input.url, !options.isPackaged)
      const anonKey = String(input.anonKey || '').trim()
      if (anonKey.length < 20 || anonKey.length > 500) throw new Error('Проверьте anon / publishable key Supabase.')
      if (url !== config.url || anonKey !== config.anonKey) {
        config.url = url
        config.anonKey = anonKey
        session = null
        config.encryptedSession = ''
      }
      await persist()
      return publicStatus()
    },

    async signUp(input = {}) {
      await load()
      const email = String(input.email || '').trim().toLowerCase()
      const password = String(input.password || '')
      const displayName = String(input.displayName || '').trim().slice(0, 60)
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('Введите корректный адрес электронной почты.')
      if (password.length < 10 || password.length > 128) throw new Error('Пароль должен содержать не меньше 10 символов.')
      const data = await request('/auth/v1/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, data: { display_name: displayName || 'Игрок' } })
      }, false)
      if (data && data.access_token) await persistSession(data)
      return {
        signedIn: !!(data && data.access_token),
        confirmationRequired: !(data && data.access_token),
        email: data?.user?.email || email
      }
    },

    async signIn(input = {}) {
      await load()
      const email = String(input.email || '').trim().toLowerCase()
      const password = String(input.password || '')
      if (!email || !password) throw new Error('Введите электронную почту и пароль.')
      const data = await request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      }, false)
      await persistSession(data)
      return publicStatus()
    },

    async signOut() {
      await load()
      if (session?.access_token && configured()) {
        try { await request('/auth/v1/logout', { method: 'POST' }) } catch { /* local sign-out still succeeds */ }
      }
      session = null
      config.encryptedSession = ''
      await persist()
      return publicStatus()
    },

    async myProfile() {
      await ensureSession()
      const id = session.user.id
      const rows = await rest('profiles?select=' + PROFILE_FIELDS.split(',').join(',') + '&id=eq.' + encodeURIComponent(id) + '&limit=1')
      return Array.isArray(rows) ? rows[0] || null : null
    },

    async isDeveloper() {
      await ensureSession()
      return !!(await rest('rpc/is_app_developer', {
        method: 'POST',
        body: '{}'
      }))
    },

    async setProfileBadges(handle, badges) {
      await ensureSession()
      return await rest('rpc/developer_set_profile_badges', {
        method: 'POST',
        body: JSON.stringify({
          target_handle: String(handle || '').trim().toLowerCase(),
          new_badges: Array.isArray(badges) ? badges : []
        })
      })
    },

    async updateMyProfile(input = {}) {
      await ensureSession()
      const body = {}
      if (input.handle != null) body.handle = String(input.handle).trim().toLowerCase()
      if (input.displayName != null) body.display_name = String(input.displayName).trim().slice(0, 60)
      if (input.bio != null) body.bio = String(input.bio).trim().slice(0, 280)
      if (input.avatar != null) body.avatar = String(input.avatar).slice(0, 16)
      if (input.isPublic != null) body.is_public = !!input.isPublic
      const rows = await rest('profiles?id=eq.' + encodeURIComponent(session.user.id) + '&select=' + PROFILE_FIELDS, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(body)
      })
      return Array.isArray(rows) ? rows[0] || null : null
    },

    async listPublicProfiles(query = '') {
      await refreshSession()
      const params = new URLSearchParams({
        select: PROFILE_FIELDS,
        is_public: 'eq.true',
        order: 'updated_at.desc',
        limit: '40'
      })
      const term = String(query || '').trim().replace(/[,*()]/g, '').slice(0, 40)
      if (term) params.set('or', '(handle.ilike.*' + term + '*,display_name.ilike.*' + term + '*)')
      return rest('profiles?' + params.toString())
    },

    async publicProfile(handle) {
      await refreshSession()
      const safeHandle = String(handle || '').trim().toLowerCase()
      if (!/^[a-z0-9_]{3,24}$/.test(safeHandle)) throw new Error('Некорректное имя профиля.')
      const rows = await rest('profiles?select=' + PROFILE_FIELDS + '&handle=eq.' + encodeURIComponent(safeHandle) + '&limit=1')
      if (!Array.isArray(rows) || !rows.length) return null
      const reviews = await rest('reviews?select=id,game_id,genre_id,score,coverage,review_title,verdict,pros,cons,criterion_ratings,updated_at,game:games(id,steam_app_id,title,slug,header_image,release_date)&profile_id=eq.' + encodeURIComponent(rows[0].id) + '&is_public=eq.true&order=updated_at.desc&limit=100')
      return { profile: rows[0], reviews: Array.isArray(reviews) ? reviews : [] }
    },

    async searchSteam(term) {
      const query = String(term || '').trim().slice(0, 100)
      if (query.length < 2) return []
      const url = 'https://store.steampowered.com/api/storesearch/?' + new URLSearchParams({ term: query, l: 'russian', cc: 'kz' })
      const result = await fetchJson(url)
      const baseItems = (Array.isArray(result.items) ? result.items : []).slice(0, 16).map((item) => ({
        steamAppId: Number(item.id),
        title: String(item.name || ''),
        image: String(item.tiny_image || ''),
        headerImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + Number(item.id) + '/header.jpg',
        price: item.price?.final ? item.price.final / 100 : null,
        currency: item.price?.currency || 'RUB',
        storeUrl: 'https://store.steampowered.com/app/' + Number(item.id) + '/'
      })).filter((item) => Number.isSafeInteger(item.steamAppId) && item.steamAppId > 0)
      return await this.enrichSteamList(baseItems, 6)
    },

    async enrichSteamList(items, maxEnrich = 4) {
      return items.map((item) => {
        const cached = steamDetailsCache.get(item.steamAppId)
        if (cached && Date.now() - cached.ts < 600000) {
          return { ...item, ...cached.data, image: cached.data.headerImage || item.headerImage || item.image }
        }
        return item
      })
    },

    async steamFeatured(section = 'featured') {
      const nowMs = Date.now()
      if (!featuredCache.data || nowMs - featuredCache.ts > 300000) {
        try {
          featuredCache = {
            ts: nowMs,
            data: await fetchJson('https://store.steampowered.com/api/featuredcategories/?l=russian&cc=kz')
          }
        } catch {
          featuredCache = { ts: nowMs, data: {} }
        }
      }
      const fc = featuredCache.data || {}
      const pick = (key) => (Array.isArray(fc[key]?.items) ? fc[key].items : [])
        .filter((it) => it && Number(it.type || 0) === 0 && Number.isSafeInteger(Number(it.id)) && Number(it.id) > 0)
        .map((it) => ({
          steamAppId: Number(it.id),
          title: String(it.name || ''),
          image: String(it.header_image || it.large_capsule_image || it.small_capsule_image || ''),
          headerImage: String(it.header_image || it.large_capsule_image || ''),
          price: it.final_price ? it.final_price / 100 : null,
          discountPercent: Number(it.discount_percent) || 0,
          currency: it.currency || 'RUB',
          storeUrl: 'https://store.steampowered.com/app/' + Number(it.id) + '/'
        }))

      let list = []
      if (section === 'top_sellers') list = pick('top_sellers')
      else if (section === 'new_releases') list = pick('new_releases')
      else if (section === 'specials') list = pick('specials')
      else {
        let sharedGames = []
        if (configured()) {
          try {
            const rows = await rest('games?select=steam_app_id,title,header_image,store_url,description,genres,developers,release_date&order=updated_at.desc&limit=12')
            if (Array.isArray(rows)) {
              sharedGames = rows.map((r) => ({
                steamAppId: Number(r.steam_app_id),
                title: String(r.title || ''),
                image: String(r.header_image || 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + Number(r.steam_app_id) + '/header.jpg'),
                headerImage: String(r.header_image || 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + Number(r.steam_app_id) + '/header.jpg'),
                description: String(r.description || ''),
                genres: Array.isArray(r.genres) ? r.genres : [],
                developers: Array.isArray(r.developers) ? r.developers : [],
                releaseDate: String(r.release_date || ''),
                storeUrl: String(r.store_url || 'https://store.steampowered.com/app/' + Number(r.steam_app_id) + '/')
              })).filter((g) => g.steamAppId > 0 && g.title)
            }
          } catch { /* ignore */ }
        }
        const curated = CURATED_GAMES.map((g) => ({
          steamAppId: g.steamAppId,
          title: g.title,
          image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + g.steamAppId + '/header.jpg',
          headerImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + g.steamAppId + '/header.jpg',
          storeUrl: 'https://store.steampowered.com/app/' + g.steamAppId + '/'
        }))
        const merged = sharedGames.concat(curated, pick('top_sellers'), pick('specials'))
        const seen = new Set()
        list = merged.filter((it) => {
          if (seen.has(it.steamAppId)) return false
          seen.add(it.steamAppId)
          return true
        })
      }
      const enriched = await this.enrichSteamList(list.slice(0, 14), 6)
      return enriched.filter((it) => it.title)
    },

    async steamDetails(steamAppId) {
      const id = Number(steamAppId)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Некорректный Steam App ID.')
      const cached = steamDetailsCache.get(id)
      if (cached && Date.now() - cached.ts < 600000) return cached.data

      let entry = null
      for (const cc of ['kz', 'us', 'ru']) {
        try {
          const url = 'https://store.steampowered.com/api/appdetails/?' + new URLSearchParams({ appids: String(id), l: 'russian', cc })
          const result = await fetchJson(url)
          if (result && result[String(id)]?.success && result[String(id)]?.data) {
            entry = result[String(id)]
            break
          }
        } catch {
          /* try next region */
        }
      }
      if (!entry?.success || !entry.data) throw new Error('Steam не вернул данные для этой игры (App ID ' + id + ').')
      const game = entry.data
      const data = {
        steamAppId: id,
        title: String(game.name || ''),
        description: String(game.short_description || ''),
        aboutText: cleanSteamHtmlToText(game.about_the_game || game.detailed_description || ''),
        releaseDate: game.release_date?.date || '',
        developers: Array.isArray(game.developers) ? game.developers : [],
        publishers: Array.isArray(game.publishers) ? game.publishers : [],
        genres: Array.isArray(game.genres) ? game.genres.map((g) => g.description).filter(Boolean) : [],
        tags: Array.isArray(game.categories) ? game.categories.map((c) => c.description).filter(Boolean).slice(0, 16) : [],
        screenshots: Array.isArray(game.screenshots) ? game.screenshots.slice(0, 16).map((s) => ({
          id: s.id,
          thumb: String(s.path_thumbnail || ''),
          full: String(s.path_full || s.path_thumbnail || '')
        })).filter((s) => s.thumb) : [],
        achievementsTotal: Number(game.achievements?.total) || 0,
        achievementsHighlighted: Array.isArray(game.achievements?.highlighted) ? game.achievements.highlighted.slice(0, 8).map((a) => ({
          name: String(a.name || ''),
          icon: String(a.path || '')
        })) : [],
        supportedLanguages: cleanSteamHtmlToText(game.supported_languages || '').replace(/\*\s*озвучка.*$/i, '').trim(),
        pcMinimum: cleanSteamHtmlToText(game.pc_requirements?.minimum || ''),
        pcRecommended: cleanSteamHtmlToText(game.pc_requirements?.recommended || ''),
        website: typeof game.website === 'string' ? game.website : '',
        platforms: game.platforms ? Object.entries(game.platforms).filter(([, enabled]) => enabled).map(([name]) => name) : [],
        headerImage: String(game.header_image || ''),
        isFree: !!game.is_free,
        priceText: game.is_free ? 'Бесплатно' : (game.price_overview?.final_formatted || ''),
        discountPercent: Number(game.price_overview?.discount_percent) || 0,
        storeUrl: 'https://store.steampowered.com/app/' + id + '/',
        metacritic: game.metacritic ? { score: Number(game.metacritic.score) || null, url: String(game.metacritic.url || '') } : null,
        steamRecommendationCount: Number(game.recommendations?.total) || 0,
        steamUserScore: null
      }
      steamDetailsCache.set(id, { ts: Date.now(), data })
      return data
    },

    async steamReviews(steamAppId) {
      const id = Number(steamAppId)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Некорректный Steam App ID.')
      const url = 'https://store.steampowered.com/appreviews/' + id + '?' + new URLSearchParams({ json: '1', language: 'all', purchase_type: 'all', num_per_page: '0' })
      const result = await fetchJson(url)
      const summary = result.query_summary || {}
      return {
        description: String(summary.review_score_desc || ''),
        total: Number(summary.total_reviews) || 0,
        positive: Number(summary.total_positive) || 0,
        negative: Number(summary.total_negative) || 0,
        percentPositive: Number(summary.total_reviews) > 0 ? Math.round((Number(summary.total_positive) / Number(summary.total_reviews)) * 1000) / 10 : null
      }
    },

    async publicGameSearch(query = '') {
      await refreshSession()
      const term = String(query || '').trim().replace(/[,*()]/g, '').slice(0, 80)
      const params = new URLSearchParams({
        select: 'id,steam_app_id,title,slug,description,release_date,developers,publishers,genres,platforms,header_image,store_url',
        order: 'title.asc',
        limit: '40'
      })
      if (term) params.set('title', 'ilike.*' + term + '*')
      return rest('games?' + params.toString())
    },

    async publicGame(idOrSteamId) {
      await refreshSession()
      const raw = String(idOrSteamId || '')
      const filter = /^\d+$/.test(raw) ? 'steam_app_id=eq.' + raw : 'id=eq.' + encodeURIComponent(raw)
      const fields = 'id,steam_app_id,title,slug,description,release_date,developers,publishers,genres,platforms,header_image,store_url,created_at'
      const rows = await rest('games?select=' + fields + '&' + filter + '&limit=1')
      if (!Array.isArray(rows) || !rows.length) return null
      const game = rows[0]
      const [scores, summary, reviews] = await Promise.all([
        rest('external_ratings?select=source,score,max_score,vote_count,url,fetched_at&game_id=eq.' + encodeURIComponent(game.id) + '&order=source.asc'),
        rest('game_rating_summary?select=genre_id,review_count,average_score,average_coverage&game_id=eq.' + encodeURIComponent(game.id) + '&order=review_count.desc'),
        rest('reviews?select=id,profile_id,genre_id,score,coverage,review_title,verdict,pros,cons,criterion_ratings,updated_at,profile:profiles(handle,display_name,avatar,badges)&game_id=eq.' + encodeURIComponent(game.id) + '&is_public=eq.true&order=updated_at.desc&limit=50')
      ])
      return {
        game,
        externalRatings: Array.isArray(scores) ? scores : [],
        community: Array.isArray(summary) ? summary : [],
        reviews: Array.isArray(reviews) ? reviews : []
      }
    },

    async communityBySteamIds(steamAppIds = []) {
      await refreshSession()
      if (!configured()) return {}
      const ids = Array.from(new Set((Array.isArray(steamAppIds) ? steamAppIds : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))).slice(0, 40)
      const gameQuery = ids.length
        ? 'games?select=id,steam_app_id,title&steam_app_id=in.(' + ids.join(',') + ')'
        : 'games?select=id,steam_app_id,title&order=updated_at.desc&limit=20'
      const games = await rest(gameQuery)
      if (!Array.isArray(games) || !games.length) return {}
      const gameIds = games.map((g) => g.id)
      const inList = '(' + gameIds.map((id) => '"' + String(id).replace(/"/g, '') + '"').join(',') + ')'
      const [reviews] = await Promise.all([
        rest('reviews?select=id,game_id,profile_id,genre_id,score,coverage,verdict,pros,cons,criterion_ratings,updated_at,profile:profiles(handle,display_name,avatar,badges)&game_id=in.' + inList + '&is_public=eq.true&order=updated_at.desc&limit=100')
      ])
      const byGameId = new Map(games.map((g) => [g.id, g.steam_app_id]))
      const out = {}
      for (const g of games) {
        out[g.steam_app_id] = { gameId: g.id, count: 0, average: null, reviews: [] }
      }
      for (const rev of Array.isArray(reviews) ? reviews : []) {
        const appId = byGameId.get(rev.game_id)
        if (!appId || !out[appId]) continue
        out[appId].reviews.push(rev)
      }
      for (const item of Object.values(out)) {
        item.count = item.reviews.length
        if (item.count > 0) {
          const sum = item.reviews.reduce((acc, r) => acc + (Number(r.score) || 0), 0)
          item.average = Math.round((sum / item.count) * 10) / 10
        }
      }
      return out
    },

    async addSteamGame(steamAppId) {
      const details = await this.steamDetails(steamAppId)
      await ensureSession()
      const releaseDate = parseSteamDate(details.releaseDate)
      const slug = slugify(details.title) + '-' + details.steamAppId
      const payload = {
        steam_app_id: details.steamAppId,
        title: details.title,
        slug,
        description: details.description,
        release_date: releaseDate,
        developers: details.developers,
        publishers: details.publishers,
        genres: details.genres,
        platforms: details.platforms,
        header_image: details.headerImage,
        store_url: details.storeUrl,
        source_data: { about: details.aboutText || '', metacritic: details.metacritic, tags: details.tags || [], screenshots: details.screenshots || [] },
        added_by: session.user.id
      }
      const inserted = await rest('games?on_conflict=steam_app_id&select=id,steam_app_id,title,slug,description,release_date,developers,publishers,genres,platforms,header_image,store_url', {
        method: 'POST',
        headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(payload)
      })
      if (Array.isArray(inserted) && inserted.length) return inserted[0]
      const existing = await this.publicGame(details.steamAppId)
      if (existing?.game) return existing.game
      throw new Error('Steam-игра загружена, но не появилась в общем каталоге.')
    },

    async saveReview(input = {}) {
      await ensureSession()
      const gameId = String(input.gameId || '')
      if (!gameId) throw new Error('Не выбрана игра.')
      const score = Number(input.score)
      const coverage = Number(input.coverage)
      if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Оценка должна быть от 0 до 100.')
      const payload = {
        profile_id: session.user.id,
        game_id: gameId,
        genre_id: String(input.genreId || 'other').slice(0, 80),
        score: Math.round(score * 10) / 10,
        coverage: Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0,
        scoring_version: String(input.scoringVersion || '1.0.0').slice(0, 40),
        official_patch_ids: Array.isArray(input.officialPatchIds) ? input.officialPatchIds.map((id) => String(id).slice(0, 80)).slice(0, 100) : [],
        review_title: String(input.reviewTitle || '').slice(0, 120),
        verdict: String(input.verdict || '').slice(0, 4000),
        pros: String(input.pros || '').slice(0, 8000),
        cons: String(input.cons || '').slice(0, 8000),
        criterion_ratings: input.criterionRatings && typeof input.criterionRatings === 'object' ? input.criterionRatings : {},
        is_public: input.isPublic !== false
      }
      const rows = await rest('reviews?on_conflict=profile_id,game_id&select=*', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload)
      })
      return Array.isArray(rows) ? rows[0] || null : null
    },

    async listAppPatches() {
      await refreshSession()
      const rows = await rest('app_patches?select=patch_id,name,version,description,operations,is_enabled,created_at,updated_at&order=updated_at.desc')
      return Array.isArray(rows) ? rows : []
    },

    async publishAppPatch(input = {}) {
      await ensureSession()
      const id = String(input.id || '').trim()
      const name = String(input.name || '').trim()
      const operations = input.operations
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(id)) throw new Error('id патча: латиница, цифры, точка, дефис или подчёркивание (3–80 символов).')
      if (!name || name.length > 120) throw new Error('Укажите название патча (до 120 символов).')
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) throw new Error('Патч должен содержать от 1 до 500 операций.')
      const body = {
        patch_id: id,
        name,
        version: String(input.version || '1.0.0').slice(0, 40),
        description: String(input.description || '').slice(0, 2000),
        operations,
        is_enabled: input.enabled !== false,
        created_by: session.user.id
      }
      const rows = await rest('app_patches?on_conflict=patch_id&select=*', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(body)
      })
      return Array.isArray(rows) ? rows[0] || null : null
    },

    async toggleAppPatch(id, enabled) {
      await ensureSession()
      const safeId = String(id || '')
      const rows = await rest('app_patches?patch_id=eq.' + encodeURIComponent(safeId) + '&select=*', {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ is_enabled: !!enabled })
      })
      return Array.isArray(rows) ? rows[0] || null : null
    },

    async deleteAppPatch(id) {
      await ensureSession()
      const safeId = String(id || '')
      await rest('app_patches?patch_id=eq.' + encodeURIComponent(safeId), { method: 'DELETE' })
      return { ok: true }
    }
  }
}

async function fetchJson(url) {
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(12000)
    })
  } catch {
    throw new Error('Не удалось подключиться к Steam. Проверьте интернет и повторите попытку.')
  }
  if (!response.ok) throw new Error('Steam вернул ошибку (' + response.status + ').')
  try { return await response.json() } catch { throw new Error('Steam вернул ответ в неожиданном формате.') }
}

function parseSteamDate(value) {
  const text = String(value || '')
  const match = text.match(/\b(19|20)\d{2}\b/)
  return match ? match[0] + '-01-01' : null
}

function cleanSteamHtmlToText(html) {
  return String(html || '')
    .replace(/<(video|source|img)[^>]*>/gi, '')
    .replace(/<\/video>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|ul)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'game'
}

module.exports = { createCloud, normalizeBaseUrl }
