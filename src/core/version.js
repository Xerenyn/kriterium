'use strict'

// Размеры версий: чистая функция отдельно — чтобы тестировалась без Electron.
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function versionFromTag(tag) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(String(tag || '').trim())
  return m ? m[1] : null
}

module.exports = { compareVersions, versionFromTag }
