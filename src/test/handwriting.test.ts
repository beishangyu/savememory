// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyPressureStrength,
  blobToBase64,
  canvasToBlob,
  DEFAULT_INK_COLOR,
  INK_PALETTE,
  shouldAcceptPointer,
  strokeWidthForPressure,
} from '../lib/handwriting'

describe('指针接受规则（防误触）', () => {
  it('auto 模式下笔、鼠标和手指都能写', () => {
    expect(shouldAcceptPointer('pen', 'auto', false)).toBe(true)
    expect(shouldAcceptPointer('mouse', 'auto', false)).toBe(true)
    expect(shouldAcceptPointer('touch', 'auto', false)).toBe(true)
  })

  it('一旦检测到笔，auto 模式就屏蔽手指（防手掌误触）', () => {
    expect(shouldAcceptPointer('pen', 'auto', true)).toBe(true)
    expect(shouldAcceptPointer('touch', 'auto', true)).toBe(false)
  })

  it('pen 模式下手指完全不参与绘制（页面照常滚动）', () => {
    expect(shouldAcceptPointer('touch', 'pen', false)).toBe(false)
    expect(shouldAcceptPointer('touch', 'pen', true)).toBe(false)
  })

  it('pen 模式仍然接受笔', () => {
    expect(shouldAcceptPointer('pen', 'pen', false)).toBe(true)
  })

  it('pen 模式只接受手写笔，鼠标也不行', () => {
    // A finger must never leave ink, and the mode is called "仅手写笔" — so
    // only an actual stylus pointer draws.
    expect(shouldAcceptPointer('pen', 'pen', false)).toBe(true)
    expect(shouldAcceptPointer('mouse', 'pen', false)).toBe(false)
    expect(shouldAcceptPointer('touch', 'pen', false)).toBe(false)
  })

  it('auto 模式仍然接受被报成 mouse 的笔（跨品牌兜底）', () => {
    // Some Android / HarmonyOS browsers report the stylus as `mouse`. The
    // `auto` mode keeps those devices working.
    expect(shouldAcceptPointer('mouse', 'auto', false)).toBe(true)
    expect(shouldAcceptPointer('pen', 'auto', false)).toBe(true)
  })

  it('finger 模式下手指可以写，笔当然也可以写', () => {
    expect(shouldAcceptPointer('touch', 'finger', false)).toBe(true)
    expect(shouldAcceptPointer('mouse', 'finger', false)).toBe(true)
    expect(shouldAcceptPointer('pen', 'finger', false)).toBe(true)
  })
})

describe('压感笔迹宽度', () => {
  it('压力越大线条越粗', () => {
    const light = strokeWidthForPressure(0.1, 2, 6)
    const medium = strokeWidthForPressure(0.5, 2, 6)
    const heavy = strokeWidthForPressure(1, 2, 6)

    expect(light).toBeLessThan(medium)
    expect(medium).toBeLessThan(heavy)
    expect(heavy).toBeCloseTo(6)
  })

  it('压力缺失或异常时使用中间值', () => {
    expect(strokeWidthForPressure(0, 2, 6)).toBeCloseTo(4)
    expect(strokeWidthForPressure(Number.NaN, 2, 6)).toBeCloseTo(4)
    expect(strokeWidthForPressure(-1, 2, 6)).toBeCloseTo(4)
  })
})

describe('压感强度设置', () => {
  it('0% 时线条粗细完全一致（忽略压感）', () => {
    expect(applyPressureStrength(2, 8, 0)).toBe(2)
    expect(strokeWidthForPressure(0.1, 2, applyPressureStrength(2, 8, 0))).toBeCloseTo(2)
    expect(strokeWidthForPressure(1, 2, applyPressureStrength(2, 8, 0))).toBeCloseTo(2)
  })

  it('100% 时使用完整的粗细范围', () => {
    expect(applyPressureStrength(2, 8, 1)).toBe(8)
    expect(strokeWidthForPressure(0, 2, applyPressureStrength(2, 8, 1))).toBeCloseTo(5)
  })

  it('中间值按比例插值', () => {
    expect(applyPressureStrength(2, 8, 0.5)).toBeCloseTo(5)
  })

  it('异常值被夹到合法区间', () => {
    expect(applyPressureStrength(2, 8, -1)).toBe(2)
    expect(applyPressureStrength(2, 8, 5)).toBe(8)
    expect(applyPressureStrength(2, 8, Number.NaN)).toBe(8)
  })
})

describe('调色板', () => {
  it('提供一组可选墨色，且包含默认色', () => {
    expect(INK_PALETTE.length).toBeGreaterThanOrEqual(6)
    expect(INK_PALETTE).toContain(DEFAULT_INK_COLOR)
  })
})

describe('位图导出', () => {
  it('无法光栅化时返回 null 而不是抛错', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    // jsdom 没有实现 toBlob 的真实光栅化，这里只验证不会崩溃。
    const blob = await canvasToBlob(canvas)
    expect(blob === null || blob instanceof Blob).toBe(true)
  })

  it('blob 可以转成 base64 载荷', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const payload = await blobToBase64(blob)

    expect(payload.mimeType).toBe('image/png')
    expect(payload.base64.length).toBeGreaterThan(0)
    expect(payload.base64).toBe(btoa(String.fromCharCode(1, 2, 3)))
  })
})
