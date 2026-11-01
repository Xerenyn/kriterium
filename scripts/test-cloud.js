'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createCloud, normalizeBaseUrl } = require('../src/core/cloud')

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
  const cloud = createCloud(path.join(dir, 'cloud.json'), safeStorage, { isPackaged: true })

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
