'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const PROFILE_FIELDS = 'id,handle,display_name,bio,avatar,is_public,created_at'
const APP_USER_AGENT = 'Kriterium/1.0 (Windows desktop app)'

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
  let config = { url: '', anonKey: '', encryptedSession: '' }
  let session = null
  let loaded = false
  let writeQueue = Promise.resolve()

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'))
      config.url = typeof parsed.url === 'string' ? parsed.url : ''
      config.anonKey = typeof parsed.anonKey === 'string' ? parsed.anonKey : ''
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
      const url = 'https://store.steampowered.com/api/storesearch/?' + new URLSearchParams({ term: query, l: 'russian', cc: 'ru' })
      const result = await fetchJson(url)
      return (Array.isArray(result.items) ? result.items : []).slice(0, 20).map((item) => ({
        steamAppId: Number(item.id),
        title: String(item.name || ''),
        image: String(item.tiny_image || ''),
        price: item.price?.final ? item.price.final / 100 : null,
        currency: item.price?.currency || 'RUB',
        storeUrl: 'https://store.steampowered.com/app/' + Number(item.id) + '/'
      })).filter((item) => Number.isSafeInteger(item.steamAppId) && item.steamAppId > 0)
    },

    async steamDetails(steamAppId) {
      const id = Number(steamAppId)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Некорректный Steam App ID.')
      const url = 'https://store.steampowered.com/api/appdetails/?' + new URLSearchParams({ appids: String(id), l: 'russian', cc: 'ru' })
      const result = await fetchJson(url)
      const entry = result[String(id)]
      if (!entry?.success || !entry.data) throw new Error('Steam не нашёл страницу этой игры.')
      const game = entry.data
      return {
        steamAppId: id,
        title: String(game.name || ''),
        description: String(game.short_description || ''),
        about: String(game.about_the_game || ''),
        releaseDate: game.release_date?.date || '',
        developers: Array.isArray(game.developers) ? game.developers : [],
        publishers: Array.isArray(game.publishers) ? game.publishers : [],
        genres: Array.isArray(game.genres) ? game.genres.map((g) => g.description).filter(Boolean) : [],
        platforms: game.platforms ? Object.entries(game.platforms).filter(([, enabled]) => enabled).map(([name]) => name) : [],
        headerImage: String(game.header_image || ''),
        storeUrl: 'https://store.steampowered.com/app/' + id + '/',
        metacritic: game.metacritic ? { score: Number(game.metacritic.score) || null, url: String(game.metacritic.url || '') } : null,
        steamRecommendationCount: Number(game.recommendations?.total) || 0,
        steamUserScore: null
      }
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
        rest('reviews?select=id,profile_id,genre_id,score,coverage,review_title,verdict,pros,cons,criterion_ratings,updated_at,profile:profiles(handle,display_name,avatar)&game_id=eq.' + encodeURIComponent(game.id) + '&is_public=eq.true&order=updated_at.desc&limit=50')
      ])
      return {
        game,
        externalRatings: Array.isArray(scores) ? scores : [],
        community: Array.isArray(summary) ? summary : [],
        reviews: Array.isArray(reviews) ? reviews : []
      }
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
        source_data: { about: details.about, metacritic: details.metacritic },
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

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'game'
}

module.exports = { createCloud, normalizeBaseUrl }
