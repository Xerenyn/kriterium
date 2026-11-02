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

  cloud: {
    status: () => invoke('cloud:status'),
    configure: (input) => invoke('cloud:configure', input),
    signUp: (input) => invoke('cloud:signUp', input),
    signIn: (input) => invoke('cloud:signIn', input),
    signOut: () => invoke('cloud:signOut'),
    myProfile: () => invoke('cloud:myProfile'),
    isDeveloper: () => invoke('cloud:isDeveloper'),
    setProfileBadges: (handle, badges) => invoke('cloud:setProfileBadges', handle, badges),
    updateMyProfile: (input) => invoke('cloud:updateMyProfile', input),
    listProfiles: (query) => invoke('cloud:listProfiles', query),
    publicProfile: (handle) => invoke('cloud:publicProfile', handle),
    steamSearch: (query) => invoke('cloud:steamSearch', query),
    steamFeatured: (section) => invoke('cloud:steamFeatured', section),
    steamDetails: (steamAppId) => invoke('cloud:steamDetails', steamAppId),
    steamReviews: (steamAppId) => invoke('cloud:steamReviews', steamAppId),
    publicGameSearch: (query) => invoke('cloud:publicGameSearch', query),
    publicGame: (id) => invoke('cloud:publicGame', id),
    communityBySteamIds: (ids) => invoke('cloud:communityBySteamIds', ids),
    addSteamGame: (steamAppId) => invoke('cloud:addSteamGame', steamAppId),
    saveReview: (review) => invoke('cloud:saveReview', review),
    listAppPatches: () => invoke('cloud:listAppPatches'),
    publishAppPatch: (patch) => invoke('cloud:publishAppPatch', patch),
    toggleAppPatch: (id, enabled) => invoke('cloud:toggleAppPatch', id, enabled),
    deleteAppPatch: (id) => invoke('cloud:deleteAppPatch', id),
    setupSql: () => invoke('cloud:setupSql'),
    bootstrapSql: (email) => invoke('cloud:bootstrapSql', email)
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
