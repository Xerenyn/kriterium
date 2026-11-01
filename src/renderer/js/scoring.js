/* Ядро оценки: сборка каталога, патчи, формула */
window.K = window.K || {};

(function () {
  'use strict'

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
  const clone = (value) => JSON.parse(JSON.stringify(value))

  function normalizeCatalog(catalog) {
    catalog.categories = Array.isArray(catalog.categories) ? catalog.categories : []
    catalog.genres = Array.isArray(catalog.genres) ? catalog.genres : []
    catalog.statuses = Array.isArray(catalog.statuses) ? catalog.statuses : []
    catalog.customFields = []
    for (const cat of catalog.categories) {
      if (!cat.criteria) cat.criteria = []
      if (!Number.isFinite(Number(cat.w)) || Number(cat.w) <= 0) cat.w = 1
      for (const crit of cat.criteria) {
        if (!Number.isFinite(Number(crit.w)) || Number(crit.w) <= 0) crit.w = 1
        crit.hint = crit.hint || ''
      }
    }
  }

  function findCategory(catalog, categoryId) {
    return catalog.categories.find((c) => c.id === categoryId)
  }

  function findCriterion(catalog, criterionId) {
    for (const cat of catalog.categories) {
      const crit = cat.criteria.find((c) => c.id === criterionId)
      if (crit) return { category: cat, criterion: crit }
    }
    return null
  }

  function applyOps(catalog, patch) {
    const ops = Array.isArray(patch.operations) ? patch.operations : []
    const errors = []
    for (const op of ops) {
      try {
        applyOp(catalog, op)
      } catch (err) {
        errors.push(String(err && err.message ? err.message : err))
      }
    }
    return errors
  }

  function applyOp(catalog, op) {
    if (!op || typeof op !== 'object' || !op.op) throw new Error('Пустая операция патча')

    switch (op.op) {
      case 'addCategory': {
        const cat = op.category || {}
        if (!cat.id || !cat.name) throw new Error('addCategory: нужны id и name')
        if (findCategory(catalog, cat.id)) throw new Error('Категория уже существует: ' + cat.id)
        const tier = catalog.tiers.find((t) => t.id === cat.tier)
        if (!tier) throw new Error('Неизвестный уровень: ' + cat.tier)
        catalog.categories.push({
          id: String(cat.id),
          tier: cat.tier,
          name: String(cat.name),
          w: Number(cat.w) > 0 ? Number(cat.w) : 1,
          short: String(cat.short || ''),
          criteria: Array.isArray(cat.criteria) ? cat.criteria.map(cleanCriterion) : []
        })
        break
      }

      case 'updateCategory': {
        const cat = findCategory(catalog, op.id)
        if (!cat) throw new Error('Категория не найдена: ' + op.id)
        const patch = op.patch || {}
        if (patch.name) cat.name = String(patch.name)
        if (patch.short != null) cat.short = String(patch.short)
        if (patch.w != null && Number(patch.w) > 0) cat.w = Number(patch.w)
        break
      }

      case 'removeCategory': {
        const index = catalog.categories.findIndex((c) => c.id === op.id)
        if (index < 0) throw new Error('Категория не найдена: ' + op.id)
        catalog.categories.splice(index, 1)
        break
      }

      case 'addCriterion': {
        const cat = findCategory(catalog, op.categoryId)
        if (!cat) throw new Error('Категория не найдена: ' + op.categoryId)
        const crit = cleanCriterion(op.criterion || {})
        if (!crit.id) throw new Error('addCriterion: нужен id')
        if (findCriterion(catalog, crit.id)) throw new Error('Критерий уже существует: ' + crit.id)
        cat.criteria.push(crit)
        break
      }

      case 'updateCriterion': {
        const found = findCriterion(catalog, op.id)
        if (!found) throw new Error('Критерий не найден: ' + op.id)
        const patch = op.patch || {}
        if (patch.name) found.criterion.name = String(patch.name)
        if (patch.hint != null) found.criterion.hint = String(patch.hint)
        if (patch.w != null && Number(patch.w) > 0) found.criterion.w = Number(patch.w)
        break
      }

      case 'removeCriterion': {
        let removed = false
        for (const cat of catalog.categories) {
          const index = cat.criteria.findIndex((c) => c.id === op.id)
          if (index >= 0) { cat.criteria.splice(index, 1); removed = true; break }
        }
        if (!removed) throw new Error('Критерий не найден: ' + op.id)
        break
      }

      case 'addGenre': {
        const genre = op.genre || {}
        if (!genre.id || !genre.name) throw new Error('addGenre: нужны id и name')
        if (catalog.genres.some((g) => g.id === genre.id)) throw new Error('Жанр уже существует: ' + genre.id)
        catalog.genres.push({
          id: String(genre.id),
          name: String(genre.name),
          note: String(genre.note || ''),
          profile: sanitizeProfile(genre.profile, catalog)
        })
        break
      }

      case 'updateGenre': {
        const genre = catalog.genres.find((g) => g.id === op.id)
        if (!genre) throw new Error('Жанр не найден: ' + op.id)
        const patch = op.patch || {}
        if (patch.name) genre.name = String(patch.name)
        if (patch.note != null) genre.note = String(patch.note)
        if (patch.profile && typeof patch.profile === 'object') {
          genre.profile = Object.assign({}, genre.profile, sanitizeProfile(patch.profile, catalog))
        }
        break
      }

      case 'removeGenre': {
        const index = catalog.genres.findIndex((g) => g.id === op.id)
        if (index < 0) throw new Error('Жанр не найден: ' + op.id)
        catalog.genres.splice(index, 1)
        break
      }

      case 'addField': {
        const field = op.field || {}
        if (!field.key || !field.label) throw new Error('addField: нужны key и label')
        if (catalog.customFields.some((f) => f.key === field.key) || ['verdict', 'pros', 'cons', 'notes'].includes(field.key)) {
          throw new Error('Поле уже существует: ' + field.key)
        }
        catalog.customFields.push({
          key: String(field.key),
          label: String(field.label),
          type: ['text', 'textarea', 'number', 'date', 'select'].includes(field.type) ? field.type : 'text',
          placeholder: String(field.placeholder || ''),
          options: Array.isArray(field.options) ? field.options.map(String) : []
        })
        break
      }

      case 'removeField': {
        const index = catalog.customFields.findIndex((f) => f.key === op.key)
        if (index < 0) throw new Error('Поле не найдено: ' + op.key)
        catalog.customFields.splice(index, 1)
        break
      }

      case 'addStatus': {
        const status = op.status || {}
        if (!status.id || !status.name) throw new Error('addStatus: нужны id и name')
        if (catalog.statuses.some((s) => s.id === status.id)) throw new Error('Статус уже существует: ' + status.id)
        catalog.statuses.push({ id: String(status.id), name: String(status.name) })
        break
      }

      default:
        throw new Error('Неизвестная операция: ' + op.op)
    }
  }

  function cleanCriterion(crit) {
    return {
      id: String(crit.id || ''),
      name: String(crit.name || ''),
      w: Number(crit.w) > 0 ? Number(crit.w) : 1,
      hint: String(crit.hint || ''),
      anchors: crit.anchors && typeof crit.anchors === 'object' ? crit.anchors : undefined
    }
  }

  function sanitizeProfile(profile, catalog) {
    const out = {}
    if (!profile || typeof profile !== 'object') return out
    for (const [key, value] of Object.entries(profile)) {
      if (!catalog.categories.some((c) => c.id === key)) continue
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out[key] = clamp(n, 0.05, 5)
    }
    return out
  }

  /**
   * Собирает рабочий каталог: базовые критерии + включённые патчи + жанровые множители.
   */
  function buildCatalog(base, patches, genreId) {
    const catalog = clone(base)
    normalizeCatalog(catalog)

    for (const patch of patches || []) {
      if (patch.enabled === false) continue
      applyOps(catalog, patch)
    }

    const genre = (catalog.genres || []).find((g) => g.id === genreId) || null
    const profile = (genre && genre.profile) || {}

    for (const cat of catalog.categories) {
      const multiplier = Number(profile[cat.id])
      cat.multiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
      cat.effW = cat.w * cat.multiplier
    }

    for (const tier of catalog.tiers) {
      const cats = catalog.categories.filter((c) => c.tier === tier.id)
      const sum = cats.reduce((acc, c) => acc + c.effW, 0)
      tier.catIds = cats.map((c) => c.id)
      for (const cat of cats) {
        cat.points = sum > 0 ? (tier.points * cat.effW) / sum : 0
      }
      tier.categoryCount = cats.length
    }

    catalog.genre = genre
    catalog.fields = catalog.customFields
    return catalog
  }

  function gradeFor(catalog, total) {
    if (total == null) return null
    const grades = catalog.grades || []
    for (const grade of grades) {
      if (total >= grade.min) return grade
    }
    return grades[grades.length - 1] || null
  }

  function computeScore(catalog, ratings) {
    const cells = ratings || {}
    const tiers = []
    const categories = []
    let totalRated = 0
    let totalApplicable = 0

    for (const tier of catalog.tiers) {
      const tierCats = catalog.categories.filter((c) => c.tier === tier.id)
      const active = []
      let tierRated = 0
      let tierApplicable = 0

      for (const cat of tierCats) {
        let weightSum = 0
        let valueSum = 0
        let rated = 0
        let applicable = 0

        for (const crit of cat.criteria) {
          const cell = cells[crit.id]
          if (cell && cell.na) continue
          applicable += 1
          if (cell && cell.v != null && Number.isFinite(Number(cell.v))) {
            const value = clamp(Number(cell.v), 0, 10)
            rated += 1
            weightSum += crit.w
            valueSum += crit.w * value
          }
        }

        tierRated += rated
        tierApplicable += applicable
        const score = rated > 0 && weightSum > 0 ? valueSum / weightSum : null
        const row = {
          id: cat.id,
          name: cat.name,
          tier: cat.tier,
          points: cat.points || 0,
          score,
          earned: 0,
          rated,
          applicable,
          multiplier: cat.multiplier || 1
        }
        categories.push(row)
        if (score != null) active.push({ row, cat })
      }

      const activeWeight = active.reduce((acc, item) => acc + item.cat.effW, 0)
      let earned = 0
      for (const item of active) {
        const points = activeWeight > 0 ? (tier.points * item.cat.effW) / activeWeight : 0
        item.row.points = points
        item.row.earned = (points * item.row.score) / 10
        earned += item.row.earned
      }

      tiers.push({
        id: tier.id,
        name: tier.name,
        points: tier.points,
        earned,
        score: tier.points > 0 ? (earned / tier.points) * 10 : 0,
        rated: tierRated,
        applicable: tierApplicable
      })
      totalRated += tierRated
      totalApplicable += tierApplicable
    }

    const total = tiers.reduce((acc, t) => acc + t.earned, 0)
    return {
      total,
      tiers,
      categories,
      coverage: totalApplicable > 0 ? totalRated / totalApplicable : 0,
      rated: totalRated,
      applicable: totalApplicable,
      grade: totalRated > 0 ? gradeFor(catalog, total) : null
    }
  }

  function validatePatch(patch, base) {
    const errors = []
    if (!patch || typeof patch !== 'object') return { ok: false, errors: ['Патч должен быть JSON-объектом'] }
    if (!patch.id || typeof patch.id !== 'string') errors.push('Нужен строковый id патча')
    if (patch.id && !/^[a-zA-Z0-9._-]{3,80}$/.test(patch.id)) {
      errors.push('id патча: только латиница, цифры, точка, дефис и подчёркивание (3–80 символов)')
    }
    if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
      errors.push('Нужен непустой массив operations')
    }
    if (!errors.length) {
      const probe = buildCatalog(base, [patch], null)
      // buildCatalog проглатывает ошибки операций, поэтому проверяем отдельно
      const test = clone(base)
      normalizeCatalog(test)
      const opErrors = applyOps(test, patch)
      for (const err of opErrors) errors.push(err)
      if (!probe) errors.push('Не удалось применить патч')
    }
    return { ok: errors.length === 0, errors }
  }

  function patchSummary(patch) {
    const labels = {
      addCategory: 'категория +',
      updateCategory: 'категория ~',
      removeCategory: 'категория −',
      addCriterion: 'критерий +',
      updateCriterion: 'критерий ~',
      removeCriterion: 'критерий −',
      addGenre: 'жанр +',
      updateGenre: 'жанр ~',
      removeGenre: 'жанр −',
      addField: 'поле +',
      removeField: 'поле −',
      addStatus: 'статус +'
    }
    const counts = {}
    for (const op of patch.operations || []) {
      const key = op.op in labels ? labels[op.op] : op.op
      counts[key] = (counts[key] || 0) + 1
    }
    return Object.entries(counts).map(([label, count]) => ({ label, count }))
  }

  function categoriesByTier(catalog, tierId) {
    return catalog.categories.filter((c) => c.tier === tierId)
  }

  window.K.scoring = {
    buildCatalog,
    computeScore,
    gradeFor,
    validatePatch,
    patchSummary,
    applyOps,
    categoriesByTier,
    clone
  }
})()
