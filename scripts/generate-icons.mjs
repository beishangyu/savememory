/**
 * Generates the PWA icon set as PNG files.
 *
 * Deliberately dependency-free: the icons are a handful of flat geometric
 * shapes, so encoding them by hand is less code (and less weight) than pulling
 * in a raster library. Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder (8-bit RGBA)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 * Drawing helpers
 * ------------------------------------------------------------------ */

const COLORS = {
  top: [109, 140, 255],
  bottom: [63, 86, 200],
  card: [255, 255, 255],
  ink: [58, 78, 175],
}

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function blend(target, offset, [r, g, b], alpha) {
  if (alpha <= 0) return
  const inv = 1 - alpha
  target[offset] = Math.round(r * alpha + target[offset] * inv)
  target[offset + 1] = Math.round(g * alpha + target[offset + 1] * inv)
  target[offset + 2] = Math.round(b * alpha + target[offset + 2] * inv)
  target[offset + 3] = Math.round(255 * alpha + target[offset + 3] * inv)
}

/**
 * Render the app icon.
 *
 * `variant`:
 *   'any'      — rounded square with transparent corners (Android / desktop)
 *   'maskable' — full-bleed background, mark kept inside the 80% safe zone
 *   'apple'    — full-bleed background (iOS applies its own mask)
 */
function renderIcon(size, variant) {
  const rgba = Buffer.alloc(size * size * 4, 0)
  const samples = 4
  const s = size / 512 // design is authored on a 512 grid

  const bgRadius = variant === 'any' ? 112 * s : 0
  const bgSize = variant === 'any' ? size : size

  // The flashcard motif shrinks for the maskable variant to respect the safe zone.
  const scale = variant === 'maskable' ? 0.74 : 1
  const cardW = 248 * s * scale
  const cardH = 212 * s * scale
  const cardX = (size - cardW) / 2
  const cardY = (size - cardH) / 2 - 12 * s * scale
  const cardR = 26 * s * scale

  const bars = [
    { w: 172, h: 20, a: 0.95 },
    { w: 140, h: 20, a: 0.62 },
    { w: 104, h: 20, a: 0.38 },
  ].map((bar, index) => ({
    x: cardX + 36 * s * scale,
    y: cardY + 44 * s * scale + index * 44 * s * scale,
    w: bar.w * s * scale,
    h: bar.h * s * scale,
    a: bar.a,
  }))

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0
      let cardHits = 0
      const barHits = bars.map(() => 0)

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples
          const y = py + (sy + 0.5) / samples

          const inBg =
            variant === 'any'
              ? insideRoundedRect(x, y, 0, 0, bgSize, bgSize, bgRadius)
              : true
          if (!inBg) continue
          bgHits += 1

          if (insideRoundedRect(x, y, cardX, cardY, cardW, cardH, cardR)) {
            cardHits += 1
            bars.forEach((bar, index) => {
              if (insideRoundedRect(x, y, bar.x, bar.y, bar.w, bar.h, bar.h / 2)) {
                barHits[index] += 1
              }
            })
          }
        }
      }

      const total = samples * samples
      const offset = (py * size + px) * 4
      if (bgHits === 0) continue

      const t = py / size
      const bg = [
        Math.round(COLORS.top[0] + (COLORS.bottom[0] - COLORS.top[0]) * t),
        Math.round(COLORS.top[1] + (COLORS.bottom[1] - COLORS.top[1]) * t),
        Math.round(COLORS.top[2] + (COLORS.bottom[2] - COLORS.top[2]) * t),
      ]
      blend(rgba, offset, bg, bgHits / total)

      if (cardHits > 0) {
        blend(rgba, offset, COLORS.card, cardHits / total)
        bars.forEach((bar, index) => {
          if (barHits[index] > 0) {
            blend(rgba, offset, COLORS.ink, (barHits[index] / total) * bar.a)
          }
        })
      }
    }
  }

  return encodePng(size, size, rgba)
}

/* ------------------------------------------------------------------ *
 * Write the icon set
 * ------------------------------------------------------------------ */

mkdirSync(publicDir, { recursive: true })

const outputs = [
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'apple' },
]

for (const { file, size, variant } of outputs) {
  const png = renderIcon(size, variant)
  writeFileSync(resolve(publicDir, file), png)
  console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`)
}
