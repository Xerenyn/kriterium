'use strict'

// Автообновление portable-сборки через GitHub Releases.
// Проверка: api.github.com → релиз latest → ассет Kriterium-X.Y.Z.exe.
// Установка: скачивание во временную папку, затем cmd-скрипт ждёт выхода
// приложения, подменяет exe рядом с текущим и запускает новую версию.
const { app, net } = require('electron')
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const { spawn } = require('node:child_process')
const { compareVersions, versionFromTag } = require('./src/core/version')

const API_URL = 'https://api.github.com/repos/Xerenyn/kriterium/releases/latest'
const RELEASE_PAGE = 'https://github.com/Xerenyn/kriterium/releases/latest'
const ASSET_RE = /^Kriterium-(\d+\.\d+\.\d+)\.exe$/i
const CHECK_MIN_INTERVAL_MS = 30 * 60 * 1000

let status = {
  state: 'idle',          // idle | checking | available | downloading | ready | error | uptodate
  latest: null,
  assetUrl: null,
  notes: '',
  checkedAt: 0,
  error: null,
  percent: 0,
  ready: null             // { path, version }
}

let sendTo = null

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url })
    req.setHeader('Accept', 'application/vnd.github+json')
    req.setHeader('User-Agent', 'kriterium-updater')
    req.on('response', (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(body))
        } catch (err) {
          reject(new Error('Некорректный ответ сервера обновлений'))
        }
      })
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

function requestToFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url })
    req.setHeader('User-Agent', 'kriterium-updater')
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('Сервер обновлений вернул код ' + res.statusCode))
        return
      }
      const total = Number(res.headers['content-length']) || 0
      let received = 0
      const out = fs.createWriteStream(dest)
      res.on('data', (chunk) => {
        received += chunk.length
        out.write(chunk)
        const percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0
        status.percent = percent
        if (onProgress) onProgress({ received, total, percent })
      })
      res.on('end', () => {
        out.end(() => resolve({ path: dest, received, total }))
      })
      res.on('error', (err) => reject(err))
      out.on('error', (err) => reject(err))
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function checkForUpdate(force) {
  if (!force && status.checkedAt && Date.now() - status.checkedAt < CHECK_MIN_INTERVAL_MS && status.state !== 'error') {
    return buildStatus()
  }
  status.state = 'checking'
  status.error = null
  try {
    const release = await requestJson(API_URL)
    if (!release || typeof release !== 'object' || release.message) {
      throw new Error(release?.message || 'Ответ GitHub без данных')
    }
    const tagVersion = versionFromTag(release.tag_name)
    if (!tagVersion) throw new Error('Не удалось прочитать номер релиза')
    status.checkedAt = Date.now()
    status.latest = tagVersion
    status.notes = String(release.body || '').trim()
    const asset = (Array.isArray(release.assets) ? release.assets : [])
      .find((a) => ASSET_RE.test(a.name || ''))
    if (!asset) throw new Error('В релизе нет Kriterium-*.exe')
    status.assetUrl = asset.browser_download_url
    const cmp = compareVersions(tagVersion, app.getVersion())
    if (cmp > 0 || process.env.KRIT_UPDATE_FORCE) {
      status.state = 'available'
      if (sendTo) sendTo('update:available', { latest: tagVersion, notes: status.notes })
    } else {
      status.state = 'uptodate'
      status.latest = null
      status.assetUrl = null
    }
  } catch (err) {
    status.state = 'error'
    status.error = String((err && err.message) || err)
  }
  return buildStatus()
}

async function listReleases(limit) {
  const count = Math.min(30, Math.max(1, Number(limit) || 12))
  const data = await requestJson('https://api.github.com/repos/Xerenyn/kriterium/releases?per_page=' + count)
  if (!Array.isArray(data)) throw new Error(data?.message || 'GitHub не вернул список релизов')
  return data.map((release) => ({
    tag: String(release.tag_name || ''),
    name: String(release.name || ''),
    notes: String(release.body || '').trim(),
    publishedAt: String(release.published_at || ''),
    prerelease: !!release.prerelease,
    url: String(release.html_url || RELEASE_PAGE)
  }))
}

async function downloadUpdate() {
  if (status.state !== 'available' || !status.assetUrl) {
    throw new Error('Сначала проверьте обновления')
  }
  const version = status.latest
  const tmpDir = path.join(app.getPath('temp'), 'kriterium-update')
  await fsp.mkdir(tmpDir, { recursive: true })
  const dest = path.join(tmpDir, 'Kriterium-' + version + '.exe')
  status.state = 'downloading'
  status.percent = 0
  try {
    const result = await requestToFile(status.assetUrl, dest, (p) => {
      if (sendTo) sendTo('update:progress', p)
    })
    status.state = 'ready'
    status.ready = { path: dest, version }
    if (sendTo) sendTo('update:ready', status.ready)
    return result
  } catch (err) {
    status.state = 'error'
    status.error = String((err && err.message) || err)
    throw err
  }
}

// В portable-сборке путь к exe, который запускают пользователи,
// приходит из переменной окружения PORTABLE_EXECUTABLE_FILE.
function launcherInfo() {
  const launcher = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  return { file: launcher, dir: path.dirname(launcher) }
}

async function moveDownloadToAppDir(dest) {
  const { dir } = launcherInfo()
  const target = path.join(dir, path.basename(dest))
  if (path.resolve(target) === path.resolve(dest)) return target
  try {
    await fsp.rename(dest, target)
  } catch {
    await fsp.copyFile(dest, target)
    await fsp.unlink(dest).catch(() => {})
  }
  return target
}

async function installUpdate() {
  if (!status.ready) throw new Error('Обновление не скачано')
  const { dir, file } = launcherInfo()
  const dest = await moveDownloadToAppDir(status.ready.path)
  const current = app.getVersion()
  const newAbs = dest
  // Если пользователь раньше обновлялся и у него лежит промежуточный exe — он не трогается,
  // удаляется только текущий файл, из которого запущено приложение.
  const batPath = path.join(app.getPath('temp'), 'kriterium-update', 'install.cmd')
  const bat =
    '@echo off\r\n' +
    ':wait\r\n' +
    'tasklist /FI "IMAGENAME eq ' + path.basename(file) + '" | find /I "' + path.basename(file) + '" >nul\r\n' +
    'if not errorlevel 1 (\r\n' +
    '  timeout /T 1 /NOBREAK >nul\r\n' +
    '  goto wait\r\n' +
    ')\r\n' +
    'if /I not "' + path.basename(file) + '"=="' + path.basename(newAbs) + '" del /Q "' + file + '" >nul 2>nul\r\n' +
    'start "" "' + newAbs + '"\r\n' +
    'del /Q "%~f0" >nul 2>nul\r\n'
  await fsp.writeFile(batPath, bat, 'utf8')
  spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', cwd: dir }).unref()
  app.quit()
}

function buildStatus() {
  return {
    current: app.getVersion(),
    state: status.state,
    latest: status.latest,
    assetUrl: status.assetUrl,
    notes: status.notes,
    percent: status.percent,
    ready: status.ready,
    error: status.error,
    checkedAt: status.checkedAt,
    releasePage: RELEASE_PAGE
  }
}

function bind(onSend) {
  sendTo = onSend
}

module.exports = {
  bind,
  buildStatus,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  listReleases
}
