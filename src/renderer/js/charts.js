/* Графики на чистом SVG */
window.K = window.K || {};

(function () {
  'use strict'

  const U = window.K.util

  function ring(value, options) {
    const opts = options || {}
    const size = opts.size || 132
    const stroke = opts.stroke || 9
    const empty = value == null
    const color = opts.color || U.scoreColor(value)
    const pct = empty ? 0 : U.clamp(Number(value), 0, 100)
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const dash = (c * pct) / 100
    const valueText = empty ? '—' : (Math.round(pct * 10) / 10).toString().replace('.', ',')
    const sub = opts.sublabel == null ? 'из 100' : opts.sublabel
    const fs = Math.round(size / 4.2)
    // Дуга рисуется по часовой от верха; при пустом значении остаётся только дорожка-фон
    const progressCircle = empty || pct <= 0 ? '' :
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '"' +
        ' stroke-linecap="round" stroke-dasharray="' + dash + ' ' + (c - dash) + '"' +
        ' stroke-dashoffset="0" class="ring-progress"></circle>'
    const totalTag = empty ? '' : (opts.hideTotal ? '<small>/10</small>' : '<small>/100</small>')
    return '' +
      '<div class="ring' + (empty ? ' is-empty' : '') + '" style="width:' + size + 'px;height:' + size + 'px">' +
        '<svg width="' + size + '" height="' + size + '">' +
          '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.065)" stroke-width="' + stroke + '"/>' +
          progressCircle +
        '</svg>' +
        '<div class="ring-center">' +
          '<div>' +
            '<div class="ring-value' + (empty ? ' is-empty' : '') + '" style="font-size:' + fs + 'px">' + valueText + totalTag + '</div>' +
            (sub ? '<div class="ring-label">' + U.esc(sub) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
  }

  function radar(options) {
    const axes = options.axes || []
    const series = options.series || []
    const size = options.size || 350
    const pad = options.pad || 62
    const max = options.max || 10
    const n = axes.length
    if (!n) return ''

    const center = size / 2
    const radius = center - pad
    const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2
    const point = (i, value) => {
      const ratio = U.clamp(value, 0, max) / max
      return [center + Math.cos(angle(i)) * radius * ratio, center + Math.sin(angle(i)) * radius * ratio]
    }

    let svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" style="max-width:' + size + 'px;height:auto;display:block">'

    for (let level = 1; level <= 4; level += 1) {
      const ratio = level / 4
      const pts = axes.map((_, i) => {
        const x = center + Math.cos(angle(i)) * radius * ratio
        const y = center + Math.sin(angle(i)) * radius * ratio
        return x.toFixed(1) + ',' + y.toFixed(1)
      }).join(' ')
      svg += '<polygon points="' + pts + '" fill="none" stroke="rgba(255,255,255,' + (level === 4 ? '.13' : '.05') + ')" stroke-width="1"/>'
    }

    for (let i = 0; i < n; i += 1) {
      const p = point(i, max)
      svg += '<line x1="' + center + '" y1="' + center + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>'
    }

    for (const s of series) {
      const pts = (s.values || []).map((v, i) => {
        const p = point(i, v)
        return p[0].toFixed(1) + ',' + p[1].toFixed(1)
      }).join(' ')
      if (!pts) continue
      svg += '<polygon points="' + pts + '" fill="' + (s.color || '#d8d3c9') + '" fill-opacity="' + (s.fillOpacity == null ? 0.16 : s.fillOpacity) + '" stroke="' + (s.color || '#d8d3c9') + '" stroke-width="1.8" stroke-linejoin="round"/>'
      if (s.dots !== false) {
        ;(s.values || []).forEach((v, i) => {
          const p = point(i, v)
          svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.2" fill="' + (s.color || '#d8d3c9') + '"/>'
        })
      }
    }

    for (let i = 0; i < n; i += 1) {
      const a = angle(i)
      const lx = center + Math.cos(a) * (radius + 16)
      const ly = center + Math.sin(a) * (radius + 16)
      const cos = Math.cos(a)
      let anchor = 'middle'
      if (cos > 0.28) anchor = 'start'
      else if (cos < -0.28) anchor = 'end'
      const dy = Math.sin(a) > 0.5 ? 8 : Math.sin(a) < -0.5 ? -2 : 3
      svg += '<text x="' + lx.toFixed(1) + '" y="' + (ly + dy).toFixed(1) + '" fill="#7f8da6" font-size="9.5" font-family="Segoe UI, sans-serif" text-anchor="' + anchor + '">' + U.esc(axes[i].label) + '</text>'
    }

    svg += '</svg>'
    return svg
  }

  function miniBars(values, colors) {
    return '<div class="mini-bars">' + values.map((v, i) => {
      const color = colors && colors[i] ? colors[i] : U.scoreColor((v || 0) * 10)
      const width = U.clamp(v || 0, 0, 10) * 10
      return '<span><i style="width:' + width + '%;background:' + color + '"></i></span>'
    }).join('') + '</div>'
  }

  window.K.charts = { ring, radar, miniBars }
})()
