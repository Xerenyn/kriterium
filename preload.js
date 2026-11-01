'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('krit', {
  info: () => invoke('app:info'),
  catalog: () => invoke('catalog:get'),

  profile: {
    get: () => invoke('profile:get'),
    save: (data) => invoke('profile:save', data)
  },

  games: {
    list: () => invoke('games:list'),
    get: (id) => invoke('games:get', id),
    save: (game, ratings) => invoke('games:save', { game, ratings }),
    remove: (id) => invoke('games:delete', id)
  },

  ratings: {
    get: (gameId) => invoke('ratings:get', gameId),
    all: () => invoke('ratings:all')
  },

  patches: {
    list: () => invoke('patches:list'),
    save: (patch) => invoke('patches:save', patch),
    remove: (id) => invoke('patches:delete', id),
    toggle: (id) => invoke('patches:toggle', id)
  },

  meta: {
    get: (key, fallback) => invoke('meta:get', key, fallback),
    set: (key, value) => invoke('meta:set', key, value)
  },

  data: {
    export: () => invoke('data:export'),
    import: () => invoke('data:import'),
    reset: () => invoke('data:reset'),
    folder: () => invoke('data:folder'),
    saveText: (payload) => invoke('file:saveText', payload)
  },

  patchFile: () => invoke('patch:open'),

  win: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    onState: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state))
  },

  openExternal: (url) => invoke('shell:openExternal', url)
})
