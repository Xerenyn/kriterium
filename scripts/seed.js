'use strict'

/* Тестовое наполнение отдельной БД. Запуск: node scripts/seed.js <каталог данных> */

const fs = require('node:fs')
const path = require('node:path')
const { createStore } = require('../src/core/store')

const dir = process.argv[2] || path.join(process.env.TEMP || 'C:/Temp', 'krit-test', 'data')
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })

const store = createStore(dir)
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'catalog.json'), 'utf8'))

const games = [
  {
    id: 'test-disco',
    title: 'Disco Elysium',
    genre: 'rpg',
    year: 2019,
    platforms: ['PC'],
    status: 'done',
    hours: 42,
    started: '2025-11-02',
    finished: '2025-12-14',
    favorite: true,
    verdict: 'Лучший текст в играх: детектив, который на самом деле — разговор с самим собой.',
    pros: 'Сценарий и диалоги\nМир и политический подтекст\nОзвучка и музыка',
    cons: 'Финал ощущается поспешным\nМного чтения подряд утомляет',
    notes: 'Проходил с озвучкой, перечитывал внутренние монологи.',
    custom: {}
  },
  {
    id: 'test-hades',
    title: 'Hades',
    genre: 'roguelike',
    year: 2020,
    platforms: ['PC', 'Switch'],
    status: 'done',
    hours: 61,
    started: '2025-08-10',
    finished: '2025-09-27',
    favorite: true,
    verdict: 'Рогалик, в котором сюжет и цикл не мешают, а усиливают друг друга.',
    pros: 'Боевая система и обратная связь\nВариативность билдов\nМузыка Даррена Керба',
    cons: 'Поздние забеги могут стать рутинными',
    notes: 'Первое прохождение заняло 32 забега.',
    custom: {}
  },
  {
    id: 'test-rally',
    title: 'Art of Rally',
    genre: 'racing',
    year: 2020,
    platforms: ['PC'],
    status: 'endless',
    hours: 24,
    started: '2026-01-15',
    finished: '',
    favorite: false,
    verdict: 'Стильный аркадный ралли-опыт, где главное — не время, а ощущение скольжения.',
    pros: 'Арт-дирекшн\nМузыка\nОщущение управления',
    cons: 'Мало контента на длинной дистанции',
    notes: 'Возвращаюсь ради отдельных трасс.',
    custom: {}
  }
]

const profiles = {
  'test-disco': {
    core: 8, systems: 7.5, level: 7.5, narrative: 10, visual: 9, audio: 9.5, tech: 7,
    ux: 6.5, content: 8, social: null, support: 8, value: 9, original: 10,
    engage: 9.5, session: 8, emotion: 10, memory: 9.5, time: 6.5, fit: 8.5
  },
  'test-hades': {
    core: 9.5, systems: 9, level: 8.5, narrative: 8, visual: 8.5, audio: 9.5, tech: 9,
    ux: 8, content: 9, social: null, support: 9, value: 9, original: 8.5,
    engage: 9, session: 9, emotion: 8.5, memory: 9, time: 7.5, fit: 9
  },
  'test-rally': {
    core: 9, systems: 7, level: 8.5, narrative: 3.5, visual: 9.5, audio: 9, tech: 8.5,
    ux: 8, content: 7.5, social: 6, support: 8, value: 9, original: 9,
    engage: 8.5, session: 8, emotion: 8, memory: 7.5, time: 8, fit: 8.5
  }
}

let index = 0
for (const game of games) {
  const ratings = {}
  for (const cat of catalog.categories) {
    const base = profiles[game.id][cat.id]
    for (const crit of cat.criteria) {
      index += 1
      if (base == null) {
        ratings[crit.id] = { na: true }
        continue
      }
      // Детерминированно оставляем часть критериев незаполненной (покрытие не 100%).
      if (index % 9 === 0) continue
      const jitter = ((index % 5) - 2) * 0.25
      const value = Math.max(0, Math.min(10, Math.round((base + jitter) * 2) / 2))
      ratings[crit.id] = { v: value, na: false }
    }
  }
  store.saveGame(game, ratings)
}

store.saveProfile({
  nickname: 'Ксен',
  tagline: 'Играю медленно, оцениваю подробно',
  avatar: '🦊',
  accent: '#6c8cff'
})

console.log('seeded:', dir)
console.log('games:', store.listGames().length)
store.close()
