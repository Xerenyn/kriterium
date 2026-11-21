'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createCloud, normalizeBaseUrl, openLoopback, accountLabel, remainingSignInMethods } = require('../src/core/cloud')

test('Supabase URL validation only accepts approved project origins', () => {
  assert.equal(normalizeBaseUrl('https://krit-demo.supabase.co', false), 'https://krit-demo.supabase.co')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:54321', true), 'http://127.0.0.1:54321')
  assert.throws(() => normalizeBaseUrl('http://krit-demo.supabase.co', false), /HTTPS/)
  assert.throws(() => normalizeBaseUrl('https://example.com', false), /supabase\.co/)
  assert.throws(() => normalizeBaseUrl('https://krit-demo.supabase.co/rest/v1', false), /без пути/)
})

test('cloud settings persist only the public project config and validate sign-up input locally', async (t) => {
  const dir = fs.mkdtempSync(path.join('C:\\Temp', 'kriterium-cloud-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from('mock:' + value, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^mock:/, '')
  }
  const cloud = createCloud(path.join(dir, 'cloud.json'), safeStorage, { isPackaged: true, disableDefaultConfig: true })
  const outOfBox = createCloud(path.join(dir, 'fresh.json'), safeStorage, { isPackaged: true })
  assert.equal((await outOfBox.status()).configured, true)

  assert.equal((await cloud.status()).configured, false)
  await assert.rejects(cloud.configure({ url: 'https://example.org', anonKey: 'x'.repeat(32) }), /supabase\.co/)
  const configured = await cloud.configure({ url: 'https://krit-demo.supabase.co', anonKey: 'sb_publishable_test_key_0123456789' })
  assert.equal(configured.configured, true)
  assert.equal(configured.signedIn, false)

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cloud.json'), 'utf8'))
  assert.equal(saved.url, 'https://krit-demo.supabase.co')
  assert.equal(saved.anonKey, 'sb_publishable_test_key_0123456789')
  assert.equal(saved.encryptedSession, '')

  await assert.rejects(cloud.signUp({ email: 'not-an-email', password: 'long-enough-password' }), /электронной почты/)
  await assert.rejects(cloud.signUp({ email: 'owner@example.com', password: 'short' }), /10 символов/)
  await assert.rejects(cloud.signIn({ email: '', password: '' }), /электронную почту/)

  const bomPath = path.join(dir, 'legacy-cloud.json')
  fs.writeFileSync(bomPath, '\ufeff' + JSON.stringify({ url: 'https://krit-demo.supabase.co', anonKey: 'public_key_for_test', encryptedSession: '' }), 'utf8')
  const legacyConfig = createCloud(bomPath, safeStorage, { isPackaged: true })
  assert.equal((await legacyConfig.status()).configured, true)
})

test('browser sign-in callback is accepted only with the state of this attempt', async () => {
  const loopback = await openLoopback({ ports: [0], state: 'state-of-this-attempt', timeoutMs: 5000 })
  const base = 'http://127.0.0.1:' + loopback.port + '/callback'

  const foreign = await fetch(base + '?state=someone-else&code=stolen')
  assert.equal(foreign.status, 404)

  const own = await fetch(base + '?state=state-of-this-attempt&code=abc123')
  assert.equal(own.status, 200)
  assert.match(await own.text(), /Готово/)
  const params = await loopback.result
  assert.equal(params.get('code'), 'abc123')
})

test('browser sign-in gives up after its deadline and can be cancelled', async () => {
  const expired = await openLoopback({ ports: [0], state: 'state-of-this-attempt', timeoutMs: 30 })
  await assert.rejects(expired.result, /истекло/)

  const controller = new AbortController()
  const cancelled = await openLoopback({ ports: [0], state: 'state-of-this-attempt', timeoutMs: 5000, signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled.result, /отменён/)
})

test('placeholder addresses of Steam, Shikimori and Telegram accounts are never shown or counted as a password login', () => {
  const steamUser = {
    email: 'steam.76561198000000000@users.kriterium.invalid',
    user_metadata: { display_name: 'xerenyn', sign_in_provider: 'steam' },
    identities: [{ provider: 'email' }]
  }
  assert.equal(accountLabel(steamUser), 'Steam · xerenyn')
  assert.equal(accountLabel({ email: 'owner@example.com' }), 'owner@example.com')

  assert.equal(remainingSignInMethods(steamUser, ['steam'], 'steam'), 0)
  assert.equal(remainingSignInMethods(steamUser, ['steam', 'telegram'], 'steam'), 1)
  const googleAndPassword = { email: 'owner@example.com', identities: [{ provider: 'email' }, { provider: 'google' }] }
  assert.equal(remainingSignInMethods(googleAndPassword, [], 'google'), 1)
  assert.equal(remainingSignInMethods({ email: 'owner@gmail.com', identities: [{ provider: 'google' }] }, [], 'google'), 0)
})

test('external sign-in links and pending attempts are writable only by the server', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0010_external_sign_in.sql'), 'utf8')
  assert.match(migration, /revoke all on public\.external_identities from anon, authenticated/i)
  assert.match(migration, /grant select on public\.external_identities to authenticated/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*external_identities/i)
  assert.match(migration, /revoke all on public\.auth_bridge_flows from anon, authenticated/i)
  assert.doesNotMatch(migration, /grant [^;]*auth_bridge_flows/i)
})

test('developer bootstrap and application patches are server-locked', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0001_shared_catalog.sql'), 'utf8')
  const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'bootstrap-developer.sql'), 'utf8')
  assert.match(migration, /create table if not exists public\.app_roles/i)
  assert.match(migration, /revoke all on public\.app_roles from anon, authenticated/i)
  assert.match(migration, /only developer publishes application patches/i)
  assert.match(migration, /only developer edits application patches/i)
  assert.match(migration, /only developer removes application patches/i)
  assert.match(migration, /only developer edits catalog pages/i)
  assert.match(migration, /only developer publishes external ratings/i)
  assert.match(migration, /developer can moderate public posts/i)
  assert.match(bootstrap, /auth\.users/i)
  assert.match(bootstrap, /email_confirmed_at is not null/i)
})
