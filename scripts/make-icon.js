'use strict'

/**
 * Генерирует build/icon.ico (256×256, PNG внутри ICO) без внешних зависимостей.
 * Рисует тот же знак, что в интерфейсе: гексагон с внутренним ромбом.
 *
 * Запуск: node scripts/make-icon.js
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 256
const SS = 3 // суперсэмплинг для сглаживания

const BG = [17, 21, 31]          // #11151f
const ACCENT = [108, 140, 255]   // #6c8cff
const ACCENT_SOFT = [78, 102, 196]

/* ---------- геометрия ---------- */

function hexPoints(cx, cy, r, rotation) {
  const pts = []
  for (let i = 0; i < 6; i += 1) {
    const a = rotation + (Math.PI * 2 * i) / 6
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return pts
}

function pointInPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function distanceToPolygon(x, y, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    best = Math.min(best, distanceToSegment(x, y, a[0], a[1], b[0], b[1]))
  }
  return best
}

// Расстояние до границы скруглённого квадрата (отрицательное — внутри).
function roundedRectDistance(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius)
  const qy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - radius
}

/* ---------- отрисовка ---------- */

const outer = hexPoints(SIZE / 2, SIZE / 2, 96, -Math.PI / 2)
const inner = hexPoints(SIZE / 2, SIZE / 2, 52, -Math.PI / 2)

function shade(x, y) {
  // фон: скруглённый квадрат с лёгким градиентом
  const bgDist = roundedRectDistance(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, 58)
  if (bgDist > 0) return [0, 0, 0, 0]

  const grad = Math.min(1, Math.max(0, y / SIZE))
  const r = Math.round(BG[0] + 10 * (1 - grad))
  const g = Math.round(BG[1] + 12 * (1 - grad))
  const b = Math.round(BG[2] + 16 * (1 - grad))
  let out = [r, g, b, 255]

  // мягкое свечение в верхней части
  const glow = Math.hypot(x - SIZE * 0.5, y - SIZE * 0.12) / (SIZE * 0.62)
  if (glow < 1) {
    const k = (1 - glow) ** 2 * 0.5
    out = [
      Math.round(out[0] + (ACCENT[0] - out[0]) * k * 0.35),
      Math.round(out[1] + (ACCENT[1] - out[1]) * k * 0.35),
      Math.round(out[2] + (ACCENT[2] - out[2]) * k * 0.35),
      255
    ]
  }

  // внешний контур гексагона
  const outerDist = distanceToPolygon(x, y, outer)
  const onOutline = Math.abs(outerDist - 1.5) < 4.2
  if (onOutline) {
    const k = 0.85
    out = [
      Math.round(out[0] + (ACCENT_SOFT[0] - out[0]) * k),
      Math.round(out[1] + (ACCENT_SOFT[1] - out[1]) * k),
      Math.round(out[2] + (ACCENT_SOFT[2] - out[2]) * k),
      255
    ]
  }

  // внутренний ромб
  if (pointInPolygon(x, y, inner)) {
    const k = 0.95
    out = [
      Math.round(out[0] + (ACCENT[0] - out[0]) * k),
      Math.round(out[1] + (ACCENT[1] - out[1]) * k),
      Math.round(out[2] + (ACCENT[2] - out[2]) * k),
      255
    ]
  }

  return out
}

function renderRGBA() {
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  const step = 1 / SS
  const total = SS * SS

  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px2 = px + (sx + 0.5) * step
          const py2 = py + (sy + 0.5) * step
          const [cr, cg, cb, ca] = shade(px2, py2)
          const alpha = ca / 255
          r += cr * alpha
          g += cg * alpha
          b += cb * alpha
          a += ca
        }
      }
      const idx = (py * SIZE + px) * 4
      const outA = a / total
      if (outA > 0) {
        const w = a / 255
        buf[idx] = Math.round(r / w)
        buf[idx + 1] = Math.round(g / w)
        buf[idx + 2] = Math.round(b / w)
      }
      buf[idx + 3] = Math.round(outA)
    }
  }
  return buf
}

/* ---------- PNG ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8    // bit depth
  ihdr[9] = 6    // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = SIZE * 4
  const raw = Buffer.alloc((stride + 1) * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- ICO ---------- */

function encodeICO(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = 0   // 256 px
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)

  return Buffer.concat([header, entry, png])
}

/* ---------- main ---------- */

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const rgba = renderRGBA()
const png = encodePNG(rgba)
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(png))

console.log('icon:', path.join(outDir, 'icon.ico'), '(', encodeICO(png).length, 'bytes )')
