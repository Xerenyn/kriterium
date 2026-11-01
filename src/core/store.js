'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const parseJson = (value, fallback) => {
  if (value == null || value === '') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function migrate(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nickname TEXT NOT NULL DEFAULT 'Игрок',
      tagline TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '🎮',
      accent TEXT NOT NULL DEFAULT '#6c8cff',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      year INTEGER,
      platforms TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'done',
      hours REAL,
      started TEXT,
      finished TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL DEFAULT '',
      pros TEXT NOT NULL DEFAULT '',
      cons TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      criterion_id TEXT NOT NULL,
      value REAL,
      na INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (game_id, criterion_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ratings_game ON ratings(game_id);

    CREATE TABLE IF NOT EXISTS patches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      author TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      applied_at TEXT NOT NULL
    );
  `)

  const count = db.prepare('SELECT COUNT(*) AS n FROM profile').get()
  if (!count || count.n === 0) {
    const t = now()
    db.prepare('INSERT INTO profile (id, nickname, tagline, avatar, accent, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)')
      .run('Игрок', 'Личный профиль оценок', '🎮', '#6c8cff', t, t)
  }

  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .run('schema_version', JSON.stringify(3))
}

function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'kriterium.db')
  const db = new DatabaseSync(dbPath)
  migrate(db)

  const stmt = {
    profileGet: db.prepare('SELECT * FROM profile WHERE id = 1'),
    profileUpdate: db.prepare(`UPDATE profile SET nickname = ?, tagline = ?, avatar = ?, accent = ?, updated_at = ? WHERE id = 1`),
    gamesAll: db.prepare('SELECT * FROM games ORDER BY datetime(updated_at) DESC, title ASC'),
    gameGet: db.prepare('SELECT * FROM games WHERE id = ?'),
    gameInsert: db.prepare(`INSERT INTO games
      (id, title, genre, year, platforms, status, hours, started, finished, favorite, verdict, pros, cons, notes, custom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    gameUpdate: db.prepare(`UPDATE games SET
      title = ?, genre = ?, year = ?, platforms = ?, status = ?, hours = ?, started = ?, finished = ?,
      favorite = ?, verdict = ?, pros = ?, cons = ?, notes = ?, custom = ?, updated_at = ?
      WHERE id = ?`),
    gameDelete: db.prepare('DELETE FROM games WHERE id = ?'),
    ratingsGame: db.prepare('SELECT criterion_id, value, na FROM ratings WHERE game_id = ?'),
    ratingsAll: db.prepare('SELECT game_id, criterion_id, value, na FROM ratings'),
    ratingInsert: db.prepare('INSERT INTO ratings (game_id, criterion_id, value, na) VALUES (?, ?, ?, ?)'),
    ratingsClear: db.prepare('DELETE FROM ratings WHERE game_id = ?'),
    patchesAll: db.prepare('SELECT * FROM patches ORDER BY datetime(applied_at) ASC'),
    patchGet: db.prepare('SELECT * FROM patches WHERE id = ?'),
    patchInsert: db.prepare(`INSERT INTO patches (id, name, version, author, description, json, enabled, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    patchUpdate: db.prepare('UPDATE patches SET json = ?, name = ?, version = ?, author = ?, description = ?, applied_at = ? WHERE id = ?'),
    patchDelete: db.prepare('DELETE FROM patches WHERE id = ?'),
    patchToggle: db.prepare('UPDATE patches SET enabled = ? WHERE id = ?'),
    metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
    metaSet: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  }

  function rowToGame(row) {
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      genre: row.genre,
      year: row.year,
      platforms: parseJson(row.platforms, []),
      status: row.status,
      hours: row.hours,
      started: row.started,
      finished: row.finished,
      favorite: !!row.favorite,
      verdict: row.verdict,
      pros: row.pros,
      cons: row.cons,
      notes: row.notes,
      custom: parseJson(row.custom, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  function rowToPatch(row) {
    if (!row) return null
    const json = parseJson(row.json, {})
    return {
      ...json,
      id: row.id,
      name: row.name,
      version: row.version,
      author: row.author,
      description: row.description,
      enabled: !!row.enabled,
      appliedAt: row.applied_at
    }
  }

  const api = {
    dir,
    dbPath,
    backend: 'sqlite',

    getProfile() {
      const row = stmt.profileGet.get()
      return {
        nickname: row.nickname,
        tagline: row.tagline,
        avatar: row.avatar,
        accent: row.accent,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    },

    saveProfile(data = {}) {
      const current = api.getProfile()
      const clean = (v, fb) => (typeof v === 'string' ? v.slice(0, 400) : fb)
      stmt.profileUpdate.run(
        clean(data.nickname, current.nickname) || 'Игрок',
        clean(data.tagline, current.tagline),
        clean(data.avatar, current.avatar) || '🎮',
        /^#[0-9a-fA-F]{6}$/.test(data.accent || '') ? data.accent : current.accent,
        now()
      )
      return api.getProfile()
    },

    listGames() {
      return stmt.gamesAll.all().map(rowToGame)
    },

    getGame(id) {
      return rowToGame(stmt.gameGet.get(id))
    },

    saveGame(game = {}, ratings = null) {
      const title = String(game.title || '').trim().slice(0, 200)
      if (!title) throw new Error('Название игры обязательно')
      const genre = String(game.genre || '').trim()
      if (!genre) throw new Error('Жанр обязателен')

      const t = now()
      const existing = stmt.gameGet.get(game.id)
      const id = game.id || uid()
      const values = [
        title,
        genre,
        game.year ? Number(game.year) : null,
        JSON.stringify(Array.isArray(game.platforms) ? game.platforms.slice(0, 20) : []),
        String(game.status || 'done'),
        game.hours !== '' && game.hours != null && Number.isFinite(Number(game.hours)) ? Number(game.hours) : null,
        game.started || null,
        game.finished || null,
        game.favorite ? 1 : 0,
        String(game.verdict || '').slice(0, 4000),
        String(game.pros || '').slice(0, 8000),
        String(game.cons || '').slice(0, 8000),
        String(game.notes || '').slice(0, 20000),
        JSON.stringify(game.custom && typeof game.custom === 'object' ? game.custom : {})
      ]

      db.exec('BEGIN')
      try {
        if (existing) {
          stmt.gameUpdate.run(...values, t, id)
        } else {
          stmt.gameInsert.run(id, ...values.slice(0, 1), ...values.slice(1), t, t)
        }
        if (ratings && typeof ratings === 'object') {
          stmt.ratingsClear.run(id)
          for (const [criterionId, cell] of Object.entries(ratings)) {
            if (!cell || typeof cell !== 'object') continue
            const na = cell.na ? 1 : 0
            let value = cell.v
            if (na) value = null
            else if (value != null) {
              const n = Number(value)
              if (!Number.isFinite(n)) continue
              value = Math.max(0, Math.min(10, n))
            } else continue
            stmt.ratingInsert.run(id, String(criterionId).slice(0, 160), value, na)
          }
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return api.getGame(id)
    },

    deleteGame(id) {
      stmt.gameDelete.run(id)
      return true
    },

    getRatings(gameId) {
      const out = {}
      for (const row of stmt.ratingsGame.all(gameId)) {
        out[row.criterion_id] = { v: row.value, na: !!row.na }
      }
      return out
    },

    getAllRatings() {
      const out = {}
      for (const row of stmt.ratingsAll.all()) {
        if (!out[row.game_id]) out[row.game_id] = {}
        out[row.game_id][row.criterion_id] = { v: row.value, na: !!row.na }
      }
      return out
    },

    listPatches() {
      return stmt.patchesAll.all().map(rowToPatch)
    },

    savePatch(patch = {}) {
      if (!patch.id) throw new Error('У патча нет id')
      const json = JSON.stringify(patch)
      const existing = stmt.patchGet.get(patch.id)
      const t = now()
      if (existing) {
        stmt.patchUpdate.run(
          json,
          String(patch.name || patch.id),
          String(patch.version || '1.0.0'),
          String(patch.author || ''),
          String(patch.description || ''),
          existing.applied_at,
          patch.id
        )
      } else {
        stmt.patchInsert.run(
          patch.id,
          String(patch.name || patch.id),
          String(patch.version || '1.0.0'),
          String(patch.author || ''),
          String(patch.description || ''),
          json,
          patch.enabled === false ? 0 : 1,
          t
        )
      }
      return api.listPatches()
    },

    deletePatch(id) {
      stmt.patchDelete.run(id)
      return api.listPatches()
    },

    togglePatch(id) {
      const row = stmt.patchGet.get(id)
      if (!row) return api.listPatches()
      stmt.patchToggle.run(row.enabled ? 0 : 1, id)
      return api.listPatches()
    },

    getMeta(key, fallback = null) {
      const row = stmt.metaGet.get(key)
      return row ? parseJson(row.value, fallback) : fallback
    },

    setMeta(key, value) {
      stmt.metaSet.run(String(key), JSON.stringify(value))
      return true
    },

    exportAll() {
      const games = api.listGames()
      return {
        app: 'kriterium',
        format: 1,
        exportedAt: now(),
        profile: api.getProfile(),
        games,
        ratings: api.getAllRatings(),
        patches: api.listPatches(),
        meta: {
          schema_version: api.getMeta('schema_version', 3)
        }
      }
    },

    importAll(data, mode = 'merge') {
      if (!data || data.app !== 'kriterium' || !Array.isArray(data.games)) {
        throw new Error('Это не файл резервной копии Критериума')
      }
      let games = 0
      let patches = 0
      db.exec('BEGIN')
      try {
        if (mode === 'replace') {
          db.exec('DELETE FROM ratings; DELETE FROM games; DELETE FROM patches;')
        }
        if (data.profile && typeof data.profile === 'object') {
          api.saveProfile(data.profile)
        }
        for (const game of data.games) {
          const ratings = data.ratings && data.ratings[game.id] ? data.ratings[game.id] : null
          api.saveGame(game, ratings)
          games += 1
        }
        for (const patch of data.patches || []) {
          api.savePatch(patch)
          patches += 1
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return { games, patches }
    },

    reset() {
      db.exec('BEGIN')
      try {
        db.exec('DELETE FROM ratings; DELETE FROM games; DELETE FROM patches; DELETE FROM meta;')
        db.exec("UPDATE profile SET nickname = 'Игрок', tagline = 'Личный профиль оценок', avatar = '🎮', accent = '#6c8cff'")
        db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', JSON.stringify(3))
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return true
    },

    close() {
      try { db.close() } catch { /* noop */ }
    }
  }

  return api
}

module.exports = { createStore }
