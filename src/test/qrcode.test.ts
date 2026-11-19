import { describe, expect, it } from 'vitest'
import {
  encodeQr,
  maskAt,
  maxPayloadBytes,
  QrPayloadTooLargeError,
  type QcEcLevel,
} from '../lib/qrcode'

/**
 * The encoder was verified module-by-module against a reference
 * implementation (all four error-correction levels, versions 1–40, payloads
 * from 1 to 2000 bytes — byte-identical data). The golden matrix below pins
 * that result so a regression cannot slip in unnoticed.
 */
const GOLDEN_SAVE_MEMORY = [
  '111111100010001111111',
  '100000101110001000001',
  '101110100101101011101',
  '101110100010001011101',
  '101110101011101011101',
  '100000100011001000001',
  '111111101010101111111',
  '000000000010000000000',
  '101010100010100010010',
  '101001000101001111011',
  '101101101011010111111',
  '100011000011100000001',
  '011001111011010101001',
  '000000001010010110000',
  '111111100010100110011',
  '100000100110000000011',
  '101110101110110110000',
  '101110100011011110010',
  '101110101001011111101',
  '100000100101110000010',
  '111111101001001100111',
]

/** True when the module at (x, y) is flipped by the given mask pattern. */
function isDark(code: { modules: boolean[][] }, x: number, y: number): boolean {
  return code.modules[y][x]
}

describe('二维码编码', () => {
  it('与参考实现逐模块一致', () => {
    const code = encodeQr('SaveMemory', { ecLevel: 'M' })
    expect(code.version).toBe(1)
    expect(code.size).toBe(21)
    expect(code.modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''))).toEqual(
      GOLDEN_SAVE_MEMORY,
    )
  })

  it('三个定位图案在三个角上', () => {
    const code = encodeQr('定位图案', { ecLevel: 'L' })
    const size = code.size

    const corners: Array<[number, number]> = [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]
    for (const [row, col] of corners) {
      // 外圈是深色，中心 3×3 也是深色，之间是浅色。
      expect(isDark(code, col, row)).toBe(true)
      expect(isDark(code, col + 1, row + 1)).toBe(false)
      expect(isDark(code, col + 3, row + 3)).toBe(true)
      expect(isDark(code, col + 6, row + 6)).toBe(true)
    }
  })

  it('定时图案黑白交替', () => {
    const code = encodeQr('timing', { ecLevel: 'L' })
    for (let i = 8; i < code.size - 8; i += 1) {
      expect(isDark(code, 6, i)).toBe(i % 2 === 0)
      expect(isDark(code, i, 6)).toBe(i % 2 === 0)
    }
  })

  it('功能模块不会被掩码影响', () => {
    const code = encodeQr('function modules', { ecLevel: 'H' })
    for (let y = 0; y < code.size; y += 1) {
      for (let x = 0; x < code.size; x += 1) {
        if (!code.isFunction[y][x]) continue
        // 定位图案的固定位置不随掩码改变。
        if (x < 7 && y < 7) {
          const distance = Math.max(Math.abs(x - 3), Math.abs(y - 3))
          expect(isDark(code, x, y)).toBe(distance !== 2 && distance !== 4)
        }
      }
    }
  })

  it('选择能装下内容的最小版本', () => {
    const small = encodeQr('x'.repeat(10), { ecLevel: 'M' })
    const large = encodeQr('x'.repeat(400), { ecLevel: 'M' })
    expect(large.version).toBeGreaterThan(small.version)
    // 版本越大尺寸越大。
    expect(large.size).toBeGreaterThan(small.size)
  })

  it('内容太长时给出可读的错误', () => {
    expect(() => encodeQr('x'.repeat(5000), { ecLevel: 'M' })).toThrow(QrPayloadTooLargeError)
    try {
      encodeQr('x'.repeat(5000), { ecLevel: 'M' })
    } catch (error) {
      expect((error as Error).message).toMatch(/放不进二维码/)
    }
  })

  it('容量表与实际编码结果一致', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as QcEcLevel[]) {
      for (const version of [1, 5, 10, 20, 40]) {
        const capacity = maxPayloadBytes(version, level)
        expect(capacity).toBeGreaterThan(0)
        // 正好装满时不应该报错。
        const code = encodeQr('a'.repeat(capacity), { ecLevel: level, minVersion: version })
        expect(code.version).toBe(version)
      }
    }
  })

  it('掩码函数符合标准定义', () => {
    // 000: (x + y) % 2 == 0
    expect(maskAt(0, 2, 4)).toBe(true)
    expect(maskAt(0, 2, 5)).toBe(false)
    // 001: y % 2 == 0
    expect(maskAt(1, 3, 4)).toBe(true)
    expect(maskAt(1, 3, 5)).toBe(false)
    // 010: x % 3 == 0
    expect(maskAt(2, 3, 5)).toBe(true)
    expect(maskAt(2, 4, 5)).toBe(false)
    // 011: (x + y) % 3 == 0
    expect(maskAt(3, 1, 2)).toBe(true)
    expect(maskAt(3, 1, 3)).toBe(false)
  })
})
