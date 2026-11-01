'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createStore } = require('./src/core/store')

const ROOT = __dirname
let mainWindow = null
let store = null
let dataDir = null

app.setName('kriterium')
app.setAppUserModelId('ru.kriterium.app')
nativeTheme.themeSource = 'dark'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#0d1016',
    title: 'Критериум',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => send('window:state', { maximized: true }))
  mainWindow.on('unmaximize', () => send('window:state', { maximized: false }))

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) console.log('[renderer]', message, '(' + sourceId + ':' + line + ')')
  })

  if (process.env.KRIT_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.KRIT_SMOKE_OUT) await fs.writeFile(process.env.KRIT_SMOKE_OUT + '.started', new Date().toISOString(), 'utf8')
          if (process.env.KRIT_ROUTE) {
            await mainWindow.webContents.executeJavaScript('location.hash = ' + JSON.stringify(process.env.KRIT_ROUTE))
            await new Promise((resolve) => setTimeout(resolve, 900))
          }
          if (process.env.KRIT_SMOKE) {
            const code = await fs.readFile(process.env.KRIT_SMOKE, 'utf8')
            const result = await mainWindow.webContents.executeJavaScript(code)
            const text = JSON.stringify(result, null, 2)
            if (process.env.KRIT_SMOKE_OUT) await fs.writeFile(process.env.KRIT_SMOKE_OUT, text, 'utf8')
            console.log('SMOKE_RESULT ' + text)
            app.exit(result && result.ok ? 0 : 1)
            return
          }
          const image = await mainWindow.webContents.capturePage()
          await fs.writeFile(process.env.KRIT_SCREENSHOT, image.toPNG())
          console.log('screenshot saved:', process.env.KRIT_SCREENSHOT)
        } catch (err) {
          console.error('screenshot failed', err)
          if (process.env.KRIT_SMOKE_OUT) {
            try { await fs.writeFile(process.env.KRIT_SMOKE_OUT + '.error.txt', String((err && err.stack) || err), 'utf8') } catch { /* noop */ }
          }
        }
        app.exit(0)
      }, 2200)
    })
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    dataDir,
    dbPath: store.dbPath,
    backend: store.backend
  }))

  ipcMain.handle('catalog:get', async () => {
    const file = path.join(ROOT, 'src', 'data', 'catalog.json')
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  })

  ipcMain.handle('profile:get', () => store.getProfile())
  ipcMain.handle('profile:save', (_e, data) => store.saveProfile(data))

  ipcMain.handle('games:list', () => store.listGames())
  ipcMain.handle('games:get', (_e, id) => store.getGame(id))
  ipcMain.handle('games:save', (_e, { game, ratings }) => store.saveGame(game, ratings))
  ipcMain.handle('games:delete', (_e, id) => store.deleteGame(id))

  ipcMain.handle('ratings:get', (_e, gameId) => store.getRatings(gameId))
  ipcMain.handle('ratings:all', () => store.getAllRatings())

  ipcMain.handle('patches:list', () => store.listPatches())
  ipcMain.handle('patches:save', (_e, patch) => store.savePatch(patch))
  ipcMain.handle('patches:delete', (_e, id) => store.deletePatch(id))
  ipcMain.handle('patches:toggle', (_e, id) => store.togglePatch(id))

  ipcMain.handle('meta:get', (_e, key, fallback) => store.getMeta(key, fallback))
  ipcMain.handle('meta:set', (_e, key, value) => store.setMeta(key, value))

  ipcMain.handle('data:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт профиля',
      defaultPath: path.join(app.getPath('documents'), `kriterium-backup-${stamp}.json`),
      filters: [{ name: 'Резервная копия', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false }
    const data = store.exportAll()
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
    return { ok: true, path: filePath }
  })

  ipcMain.handle('data:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт профиля',
      properties: ['openFile'],
      filters: [{ name: 'Резервная копия', extensions: ['json'] }]
    })
    if (canceled || !filePaths || !filePaths.length) return { ok: false }
    const raw = await fs.readFile(filePaths[0], 'utf8')
    const data = JSON.parse(raw)
    const result = store.importAll(data, 'merge')
    return { ok: true, ...result, path: filePaths[0] }
  })

  ipcMain.handle('file:saveText', async (_e, { defaultName, content, filters }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('documents'), defaultName || 'kriterium.txt'),
      filters: filters || [{ name: 'Текст', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { ok: false }
    await fs.writeFile(filePath, content, 'utf8')
    return { ok: true, path: filePath }
  })

  ipcMain.handle('patch:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Загрузить патч',
      properties: ['openFile'],
      filters: [{ name: 'Патч Критериума', extensions: ['json'] }]
    })
    if (canceled || !filePaths || !filePaths.length) return { ok: false }
    const raw = await fs.readFile(filePaths[0], 'utf8')
    return { ok: true, text: raw, path: filePaths[0] }
  })

  ipcMain.handle('data:folder', async () => {
    const error = await shell.openPath(dataDir)
    return { ok: !error, error }
  })

  ipcMain.handle('data:reset', () => {
    store.reset()
    return { ok: true }
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url)
    return false
  })
}

app.whenReady().then(() => {
  dataDir = process.env.KRIT_DATA_DIR || path.join(app.getPath('userData'), 'data')
  store = createStore(dataDir)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  try { store?.close() } catch { /* noop */ }
})
