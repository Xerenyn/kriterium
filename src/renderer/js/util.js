/* Общие утилиты интерфейса */
window.K = window.K || {};

(function () {
  'use strict'

  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ESC[ch])
  }

  function attr(value) {
    return esc(value).replace(/`/g, '&#96;')
  }

  const ICONS = {
    plus: '<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    search: '<circle cx="8.8" cy="8.8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12.8 12.8 3.7 3.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    arrow: '<path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M16 10H5M9 6l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    edit: '<path d="m4 14-.8 3.2L6.5 16 15 7.5 12.5 5 4 14Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m11.4 6.1 2.5 2.5" stroke="currentColor" stroke-width="1.5"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    export: '<path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M4 12v4h12v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    import: '<path d="M10 3v10M6.5 9.5 10 13l3.5-3.5M4 12v4h12v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    star: '<path d="m10 2.8 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8l5-.7L10 2.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    check: '<path d="m4 10.5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    close: '<path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    chevron: '<path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    spark: '<path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M15.5 4.5 13 7M7 13l-2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    save: '<path d="M4 4h9l3 3v9H4V4Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 4v4h5V4M7 16v-4h6v4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    lock: '<rect x="4" y="9" width="12" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V7a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    code: '<path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4l-2 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  }

  function icon(name, size) {
    const s = size || 16
    return '<svg viewBox="0 0 20 20" width="' + s + '" height="' + s + '" aria-hidden="true">' + (ICONS[name] || '') + '</svg>'
  }

  function toast(message, kind) {
    const root = $('#toast-root')
    if (!root) return
    const node = document.createElement('div')
    node.className = 'toast' + (kind ? ' ' + kind : '')
    node.textContent = message
    root.appendChild(node)
    setTimeout(() => {
      node.style.transition = 'opacity .25s, transform .25s'
      node.style.opacity = '0'
      node.style.transform = 'translateX(10px)'
      setTimeout(() => node.remove(), 260)
    }, 3400)
  }

  let escapeHandler = null
  function openModal(options) {
    const opts = options || {}
    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop'
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true"' + (opts.width ? ' style="width:min(' + opts.width + 'px,100%)"' : '') + '>' +
        '<div class="modal-head"><h3>' + esc(opts.title || '') + '</h3><div class="spacer"></div>' +
          '<button class="btn ghost icon" data-close aria-label="Закрыть">' + icon('close', 14) + '</button>' +
        '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
      '</div>'
    const root = $('#modal-root')
    root.appendChild(backdrop)

    function close() {
      backdrop.remove()
      if (escapeHandler === onKey) {
        document.removeEventListener('keydown', onKey)
        escapeHandler = null
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    escapeHandler = onKey

    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close()
    })
    $$('[data-close]', backdrop).forEach((btn) => btn.addEventListener('click', close))

    if (typeof opts.onMount === 'function') {
      opts.onMount({ root: backdrop, close, body: $('.modal-body', backdrop), foot: $('.modal-foot', backdrop) })
    }
    return { root: backdrop, close, body: $('.modal-body', backdrop) }
  }

  function confirmDialog(options) {
    const opts = options || {}
    return new Promise((resolve) => {
      let settled = false
      const modal = openModal({
        title: opts.title || 'Подтвердите действие',
        body: '<p class="muted" style="font-size:12.5px;line-height:1.6">' + esc(opts.text || '') + '</p>',
        footer:
          '<button class="btn ghost" data-no>Отмена</button>' +
          '<button class="btn ' + (opts.danger === false ? 'primary' : 'danger') + '" data-yes>' + esc(opts.confirmLabel || 'Подтвердить') + '</button>',
        onMount({ root, close }) {
          $('[data-no]', root).addEventListener('click', () => { settled = true; close(); resolve(false) })
          $('[data-yes]', root).addEventListener('click', () => { settled = true; close(); resolve(true) })
          const obs = new MutationObserver(() => {
            if (!root.isConnected && !settled) { settled = true; resolve(false); obs.disconnect() }
          })
          obs.observe(document.body, { childList: true, subtree: true })
        }
      })
      return modal
    })
  }

  function formatNumber(value, digits) {
    if (value == null || Number.isNaN(Number(value))) return '—'
    const d = digits == null ? 1 : digits
    return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d })
  }

  function formatDate(iso, withTime) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const base = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
    if (!withTime) return base
    return base + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  function relativeDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    const day = 86400000
    if (diff < 60000) return 'только что'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад'
    if (diff < day) return Math.floor(diff / 3600000) + ' ч назад'
    if (diff < day * 7) return Math.floor(diff / day) + ' дн назад'
    return formatDate(iso)
  }

  function scoreColor(value) {
    const v = Number(value) || 0
    if (v >= 85) return '#4bb3a1'
    if (v >= 72) return '#7fb85a'
    if (v >= 60) return '#a8bf52'
    if (v >= 48) return '#d9c04a'
    if (v >= 35) return '#e08a3d'
    return '#e0533d'
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function debounce(fn, ms) {
    let timer = null
    return function () {
      const args = arguments
      clearTimeout(timer)
      timer = setTimeout(() => fn.apply(null, args), ms || 150)
    }
  }

  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 8)
    return (prefix || 'x') + '_' + Date.now().toString(36) + rand
  }

  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100
    const last = abs % 10
    if (abs > 10 && abs < 20) return many
    if (last > 1 && last < 5) return few
    if (last === 1) return one
    return many
  }

  function initials(title) {
    const parts = String(title || '').trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }

  function splitLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function multiline(value) {
    return esc(value).replace(/\n/g, '<br>')
  }

  window.K.util = {
    $, $$, esc, attr, icon, toast, openModal, confirmDialog,
    formatNumber, formatDate, relativeDate, scoreColor, clamp, debounce,
    uid, plural, initials, splitLines, multiline
  }
})()
