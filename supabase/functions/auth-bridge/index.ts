import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID') ?? ''
const DISCORD_CLIENT_SECRET = Deno.env.get('DISCORD_CLIENT_SECRET') ?? ''
const SHIKIMORI_CLIENT_ID = Deno.env.get('SHIKIMORI_CLIENT_ID') ?? ''
const SHIKIMORI_CLIENT_SECRET = Deno.env.get('SHIKIMORI_CLIENT_SECRET') ?? ''
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_BOT_USERNAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? ''
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''

// Must stay equal to SYNTHETIC_EMAIL_DOMAIN in src/core/cloud.js: the app hides these addresses.
const SYNTHETIC_EMAIL_DOMAIN = 'users.kriterium.invalid'
const SHIKIMORI_ORIGIN = 'https://shikimori.io'
const DISCORD_API = 'https://discord.com/api'
const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
const USER_AGENT = 'Kriterium auth bridge'
// Address the browser sees on provider pages and in redirects; a proxy on the project's own domain
// (PUBLIC_BRIDGE_URL) replaces the raw supabase.co function URL.
const SELF = (Deno.env.get('PUBLIC_BRIDGE_URL') || SUPABASE_URL + '/functions/v1/auth-bridge').replace(/\/+$/, '')

const PROVIDERS = ['google', 'steam', 'discord', 'shikimori', 'telegram'] as const
type Provider = typeof PROVIDERS[number]
// Google accounts stay native Supabase identities: the bridge only hands Google's id_token back to the app.
const EXTERNAL_PROVIDERS: readonly Provider[] = PROVIDERS.filter((p) => p !== 'google')
type Flow = {
  id: string
  provider: Provider
  mode: 'login' | 'link'
  link_user_id: string | null
  redirect_port: number
  client_state: string
  confirm_code: string | null
  result: Record<string, string> | null
}
type Outcome = { token_hash: string } | { id_token: string } | { linked: Provider } | { error: string }

const PROVIDER_NAMES: Record<Provider, string> = { google: 'Google', steam: 'Steam', discord: 'Discord', shikimori: 'Shikimori', telegram: 'Telegram' }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

function configured(provider: Provider): boolean {
  if (provider === 'steam') return true
  if (provider === 'google') return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  if (provider === 'discord') return !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET)
  if (provider === 'shikimori') return !!(SHIKIMORI_CLIENT_ID && SHIKIMORI_CLIENT_SECRET)
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME && TELEGRAM_WEBHOOK_SECRET)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

class BridgeError extends Error {}

async function userFromRequest(req: Request): Promise<string> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new BridgeError('Войдите в аккаунт, чтобы привязать сервис.')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new BridgeError('Сессия истекла. Войдите в аккаунт заново.')
  return data.user.id
}

function confirmCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return chars.slice(0, 3) + '-' + chars.slice(3)
}

const flowKey = (id: string) => id.replaceAll('-', '')
const flowIdFromKey = (key: string) =>
  /^[0-9a-f]{32}$/.test(key) ? `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}` : ''

async function loadFlow(id: string, provider: Provider): Promise<Flow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const { data } = await admin.from('auth_bridge_flows').select('*')
    .eq('id', id).eq('provider', provider).gt('expires_at', new Date().toISOString()).maybeSingle()
  return (data as Flow | null) ?? null
}

async function dropFlow(id: string) {
  await admin.from('auth_bridge_flows').delete().eq('id', id)
}

function backToApp(flow: Flow, outcome: Outcome): Response {
  const target = new URL(`http://127.0.0.1:${flow.redirect_port}/callback`)
  target.searchParams.set('state', flow.client_state)
  for (const [key, value] of Object.entries(outcome)) target.searchParams.set(key, value)
  return Response.redirect(target.toString(), 302)
}

async function sessionTokenFor(email: string): Promise<{ userId: string; tokenHash: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.user || !data.properties?.hashed_token) throw new Error(error?.message ?? 'generateLink failed')
  return { userId: data.user.id, tokenHash: data.properties.hashed_token }
}

async function ownerOf(provider: Provider, providerUserId: string): Promise<string | null> {
  const { data } = await admin.from('external_identities').select('user_id')
    .eq('provider', provider).eq('provider_user_id', providerUserId).maybeSingle()
  return data?.user_id ?? null
}

async function signInAs(provider: Provider, providerUserId: string, displayName: string): Promise<Outcome> {
  const existingUserId = await ownerOf(provider, providerUserId)
  if (existingUserId) {
    const { data, error } = await admin.auth.admin.getUserById(existingUserId)
    if (error || !data.user?.email) throw new Error(error?.message ?? 'user without email')
    return { token_hash: (await sessionTokenFor(data.user.email)).tokenHash }
  }

  const email = `${provider}.${providerUserId}@${SYNTHETIC_EMAIL_DOMAIN}`
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName, sign_in_provider: provider }
  })
  if (created.error && !/already/i.test(created.error.message)) throw new Error(created.error.message)
  const { userId, tokenHash } = await sessionTokenFor(email)
  const { error } = await admin.from('external_identities')
    .insert({ provider, provider_user_id: providerUserId, user_id: userId, display_name: displayName })
  if (error && error.code !== '23505') throw new Error(error.message)

  // A parallel first sign-in may have won the insert: always mint the session for the stored owner.
  const owner = await ownerOf(provider, providerUserId)
  if (owner && owner !== userId) return signInAs(provider, providerUserId, displayName)
  return { token_hash: tokenHash }
}

async function linkTo(flow: Flow, providerUserId: string, displayName: string): Promise<Outcome> {
  const name = PROVIDER_NAMES[flow.provider]
  const owner = await ownerOf(flow.provider, providerUserId)
  if (owner === flow.link_user_id) return { linked: flow.provider }
  if (owner) return { error: `Этот аккаунт ${name} уже привязан к другому профилю Критериума.` }
  const { error } = await admin.from('external_identities').insert({
    provider: flow.provider, provider_user_id: providerUserId, user_id: flow.link_user_id, display_name: displayName
  })
  if (error?.code === '23505') return { error: `К профилю уже привязан другой аккаунт ${name}. Сначала отвяжите его.` }
  if (error) throw new Error(error.message)
  return { linked: flow.provider }
}

async function complete(flow: Flow, providerUserId: string, displayName: string): Promise<Outcome> {
  const name = displayName.trim().slice(0, 80) || `${PROVIDER_NAMES[flow.provider]} ${providerUserId.slice(-4)}`
  return flow.mode === 'link' ? linkTo(flow, providerUserId, name) : signInAs(flow.provider, providerUserId, name)
}

/* ---------- begin ---------- */

async function begin(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const provider = body.provider as Provider
  const mode = body.mode === 'link' ? 'link' : 'login'
  const port = Number(body.port)
  const state = String(body.state ?? '')
  if (!PROVIDERS.includes(provider)) return json({ error: 'Неизвестный способ входа.' }, 400)
  if (!configured(provider)) return json({ error: `Вход через ${PROVIDER_NAMES[provider]} ещё не настроен на сервере.` }, 503)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return json({ error: 'Некорректный порт возврата.' }, 400)
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return json({ error: 'Некорректный state.' }, 400)
  const nonce = String(body.nonce ?? '')
  if (provider === 'google' && !/^[0-9a-f]{64}$/.test(nonce)) return json({ error: 'Некорректный nonce.' }, 400)
  const linkUserId = mode === 'link' ? await userFromRequest(req) : null

  await admin.from('auth_bridge_flows').delete().lt('expires_at', new Date().toISOString())
  const code = provider === 'telegram' ? confirmCode() : null
  const { data, error } = await admin.from('auth_bridge_flows').insert({
    provider, mode, link_user_id: linkUserId, redirect_port: port, client_state: state, confirm_code: code
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'flow insert failed')
  const flowId = data.id as string

  if (provider === 'steam') {
    const returnTo = `${SELF}/callback/steam?flow=${flowId}`
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': SELF,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    })
    return json({ url: `${STEAM_OPENID}?${params}` })
  }
  if (provider === 'shikimori') {
    const params = new URLSearchParams({
      client_id: SHIKIMORI_CLIENT_ID,
      redirect_uri: `${SELF}/callback/shikimori`,
      response_type: 'code',
      scope: '',
      state: flowId
    })
    return json({ url: `${SHIKIMORI_ORIGIN}/oauth/authorize?${params}` })
  }
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${SELF}/callback/google`,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      nonce,
      state: flowId
    })
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
  }
  if (provider === 'discord') {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: `${SELF}/callback/discord`,
      response_type: 'code',
      scope: 'identify',
      prompt: 'none',
      state: flowId
    })
    return json({ url: `https://discord.com/oauth2/authorize?${params}` })
  }
  return json({ url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${flowKey(flowId)}`, flow: flowId, code })
}

/* ---------- Steam (OpenID 2.0) ---------- */

async function steamPersonaName(steamId: string): Promise<string> {
  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
      headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(5000)
    })
    const xml = await res.text()
    return xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/s)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function steamCallback(url: URL): Promise<Response> {
  const flow = await loadFlow(url.searchParams.get('flow') ?? '', 'steam')
  if (!flow) return text('Попытка входа устарела. Вернитесь в Критериум и нажмите «Steam» ещё раз.', 410)
  await dropFlow(flow.id)

  const returnTo = url.searchParams.get('openid.return_to') ?? ''
  const claimed = url.searchParams.get('openid.claimed_id') ?? ''
  const steamId = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1]
  if (url.searchParams.get('openid.mode') !== 'id_res' || !steamId ||
      returnTo !== `${SELF}/callback/steam?flow=${flow.id}` ||
      url.searchParams.get('openid.op_endpoint') !== STEAM_OPENID) {
    return backToApp(flow, { error: 'Steam не подтвердил вход.' })
  }

  const check = new URLSearchParams(url.searchParams)
  check.delete('flow')
  check.set('openid.mode', 'check_authentication')
  const verdict = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
    body: check,
    signal: AbortSignal.timeout(10000)
  }).then((r) => r.text())
  if (!/^is_valid:true$/m.test(verdict)) return backToApp(flow, { error: 'Steam не подтвердил вход.' })

  return backToApp(flow, await complete(flow, steamId, await steamPersonaName(steamId)))
}

/* ---------- Shikimori (OAuth 2.0) ---------- */

async function shikimoriCallback(url: URL): Promise<Response> {
  const flow = await loadFlow(url.searchParams.get('state') ?? '', 'shikimori')
  if (!flow) return text('Попытка входа устарела. Вернитесь в Критериум и нажмите «Shikimori» ещё раз.', 410)
  await dropFlow(flow.id)

  const code = url.searchParams.get('code')
  if (!code) return backToApp(flow, { error: 'Вход через Shikimori отменён.' })

  const tokenRes = await fetch(`${SHIKIMORI_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SHIKIMORI_CLIENT_ID,
      client_secret: SHIKIMORI_CLIENT_SECRET,
      code,
      redirect_uri: `${SELF}/callback/shikimori`
    }),
    signal: AbortSignal.timeout(10000)
  })
  const token = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !token.access_token) return backToApp(flow, { error: 'Shikimori не подтвердил вход.' })

  const meRes = await fetch(`${SHIKIMORI_ORIGIN}/api/users/whoami`, {
    headers: { authorization: `Bearer ${token.access_token}`, 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(10000)
  })
  const me = await meRes.json().catch(() => null)
  if (!meRes.ok || !me?.id) return backToApp(flow, { error: 'Не удалось получить профиль Shikimori.' })

  return backToApp(flow, await complete(flow, String(me.id), String(me.nickname ?? '')))
}

/* ---------- Google (OpenID Connect) ---------- */

async function googleCallback(url: URL): Promise<Response> {
  const flow = await loadFlow(url.searchParams.get('state') ?? '', 'google')
  if (!flow) return text('Попытка входа устарела. Вернитесь в Критериум и нажмите «Google» ещё раз.', 410)
  await dropFlow(flow.id)

  const code = url.searchParams.get('code')
  if (!code) return backToApp(flow, { error: 'Вход через Google отменён.' })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: `${SELF}/callback/google`
    }),
    signal: AbortSignal.timeout(10000)
  })
  const token = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !token.id_token) return backToApp(flow, { error: 'Google не подтвердил вход.' })
  return backToApp(flow, { id_token: token.id_token })
}

/* ---------- Discord (OAuth 2.0) ---------- */

async function discordCallback(url: URL): Promise<Response> {
  const flow = await loadFlow(url.searchParams.get('state') ?? '', 'discord')
  if (!flow) return text('Попытка входа устарела. Вернитесь в Критериум и нажмите «Discord» ещё раз.', 410)
  await dropFlow(flow.id)

  const code = url.searchParams.get('code')
  if (!code) return backToApp(flow, { error: 'Вход через Discord отменён.' })

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      code,
      redirect_uri: `${SELF}/callback/discord`
    }),
    signal: AbortSignal.timeout(10000)
  })
  const token = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !token.access_token) return backToApp(flow, { error: 'Discord не подтвердил вход.' })

  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}`, 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(10000)
  })
  const me = await meRes.json().catch(() => null)
  if (!meRes.ok || !me?.id) return backToApp(flow, { error: 'Не удалось получить профиль Discord.' })

  return backToApp(flow, await complete(flow, String(me.id), String(me.global_name || me.username || '')))
}

/* ---------- Telegram (bot deep link + confirmation button) ---------- */

async function telegram(method: string, payload: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  })
}

async function telegramWebhook(req: Request): Promise<Response> {
  if (!TELEGRAM_WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== TELEGRAM_WEBHOOK_SECRET) {
    return text('forbidden', 403)
  }
  const update = await req.json().catch(() => ({}))

  const message = update.message
  if (message?.chat?.type === 'private' && typeof message.text === 'string') {
    const key = message.text.match(/^\/start\s+([0-9a-f]{32})$/)?.[1] ?? ''
    const flow = key ? await loadFlow(flowIdFromKey(key), 'telegram') : null
    if (!flow || flow.result) {
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Это бот входа в Критериум. Нажмите «Telegram» на экране входа или в настройках приложения — бот пришлёт кнопку подтверждения.'
      })
    } else {
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: `${flow.mode === 'link' ? 'Привязать этот Telegram к профилю' : 'Войти в'} Критериум?\n\nКод на экране приложения должен совпадать: ${flow.confirm_code}\n\nЕсли вы не нажимали «Telegram» в Критериуме, нажмите «Отмена».`,
        reply_markup: { inline_keyboard: [[
          { text: 'Подтвердить', callback_data: `ok:${key}` },
          { text: 'Отмена', callback_data: `no:${key}` }
        ]] }
      })
    }
    return text('ok')
  }

  const query = update.callback_query
  const [action, key] = String(query?.data ?? '').split(':')
  if (query && (action === 'ok' || action === 'no')) {
    const flow = await loadFlow(flowIdFromKey(key ?? ''), 'telegram')
    let reply = 'Попытка входа устарела. Начните заново в приложении.'
    if (flow && !flow.result) {
      const from = query.from ?? {}
      const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || (from.username ? '@' + from.username : '')
      const outcome: Outcome = action === 'ok'
        ? await complete(flow, String(from.id), name)
        : { error: 'Вход отменён в Telegram.' }
      await admin.from('auth_bridge_flows').update({ result: outcome }).eq('id', flow.id)
      reply = 'error' in outcome ? outcome.error : 'Готово. Вернитесь в Критериум.'
    }
    await telegram('answerCallbackQuery', { callback_query_id: query.id })
    if (query.message) {
      await telegram('editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: reply })
    }
  }
  return text('ok')
}

async function poll(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const flow = await loadFlow(String(body.flow ?? ''), 'telegram')
  if (!flow || flow.client_state !== String(body.state ?? '')) return json({ error: 'Попытка входа устарела. Начните заново.' }, 410)
  if (!flow.result) return json({ pending: true })
  await dropFlow(flow.id)
  return json(flow.result)
}

/* ---------- unlink ---------- */

async function unlink(req: Request): Promise<Response> {
  const userId = await userFromRequest(req)
  const body = await req.json().catch(() => ({}))
  const provider = body.provider as Provider
  if (!EXTERNAL_PROVIDERS.includes(provider)) return json({ error: 'Неизвестный сервис.' }, 400)

  const [{ data: userData, error }, { data: links }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('external_identities').select('provider').eq('user_id', userId)
  ])
  if (error || !userData.user) throw new Error(error?.message ?? 'user not found')
  const user = userData.user
  const identities = user.identities ?? []
  const passwordEmail = identities.some((i) => i.provider === 'email') && !user.email?.endsWith('@' + SYNTHETIC_EMAIL_DOMAIN)
  const builtIn = identities.filter((i) => i.provider === 'google').length
  const remaining = (passwordEmail ? 1 : 0) + builtIn + (links ?? []).filter((l) => l.provider !== provider).length
  if (remaining < 1) return json({ error: 'Это единственный способ входа. Сначала привяжите другой сервис.' }, 409)

  await admin.from('external_identities').delete().eq('user_id', userId).eq('provider', provider)
  return json({ ok: true })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const route = url.pathname.replace(/^.*?\/auth-bridge/, '') || '/'
  try {
    if (req.method === 'GET' && route === '/providers') {
      return json(Object.fromEntries(PROVIDERS.map((p) => [p, configured(p)])))
    }
    if (req.method === 'POST' && route === '/begin') return await begin(req)
    if (req.method === 'GET' && route === '/callback/steam') return await steamCallback(url)
    if (req.method === 'GET' && route === '/callback/shikimori') return await shikimoriCallback(url)
    if (req.method === 'GET' && route === '/callback/discord') return await discordCallback(url)
    if (req.method === 'GET' && route === '/callback/google') return await googleCallback(url)
    if (req.method === 'POST' && route === '/telegram') return await telegramWebhook(req)
    if (req.method === 'POST' && route === '/poll') return await poll(req)
    if (req.method === 'POST' && route === '/unlink') return await unlink(req)
    return json({ error: 'not found' }, 404)
  } catch (err) {
    if (err instanceof BridgeError) return json({ error: err.message }, 401)
    console.error('auth-bridge', route, err)
    return json({ error: 'Внутренняя ошибка входа. Попробуйте ещё раз.' }, 500)
  }
})
