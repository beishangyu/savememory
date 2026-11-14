// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInkSurface } from '../hooks/useInkSurface'

afterEach(() => {
  cleanup()
})

/**
 * Build a Pointer-Events-like object.
 *
 * jsdom has no `PointerEvent` constructor, so the properties (and
 * `getCoalescedEvents`) are attached by hand.
 */
function pointerEvent(
  type: string,
  props: {
    pointerType: string
    pointerId: number
    clientX: number
    clientY: number
    buttons?: number
    coalesced?: Array<{ clientX: number; clientY: number; pressure: number }>
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const samples = props.coalesced ?? [
    { clientX: props.clientX, clientY: props.clientY, pressure: 0.5 },
  ]
  Object.defineProperties(event, {
    pointerType: { value: props.pointerType },
    pointerId: { value: props.pointerId },
    clientX: { value: props.clientX },
    clientY: { value: props.clientY },
    // 1 = the pointer is pressed, 0 = it is only hovering.
    buttons: { value: props.buttons ?? 1 },
    pressure: { value: 0.5 },
    timeStamp: { value: Date.now() },
    getCoalescedEvents: { value: () => samples },
  })
  return event
}

function dispatchOnWindow(event: Event) {
  act(() => {
    window.dispatchEvent(event)
  })
}

describe('手写采样', () => {
  it('一次 pointermove 会收下全部合并采样点（否则快速书写变成虚线）', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 7, clientX: 10, clientY: 10 }),
    )

    // 一次 move 事件里包含 5 个数位板采样点
    const coalesced = [0, 1, 2, 3, 4].map((i) => ({
      clientX: 20 + i * 10,
      clientY: 20 + i * 10,
      pressure: 0.5,
    }))
    dispatchOnWindow(
      pointerEvent('pointermove', {
        pointerType: 'pen',
        pointerId: 7,
        clientX: 20,
        clientY: 20,
        coalesced,
      }),
    )

    const strokes = result.current.getStrokes()
    expect(strokes).toHaveLength(1)
    // 1 个起点 + 5 个合并采样点
    expect(strokes[0].points).toHaveLength(6)
  })

  it('pointerId 在 down 与 move 之间变化时，笔画仍然连续', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 7, clientX: 10, clientY: 10 }),
    )
    // 某些浏览器在 down 与 move 之间会换一个 pointerId
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 99, clientX: 40, clientY: 40 }),
    )

    const strokes = result.current.getStrokes()
    expect(strokes).toHaveLength(1)
    expect(strokes[0].points).toHaveLength(2)
  })

  it('手指在笔模式下完全不参与绘制', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 40, clientY: 40 }),
    )

    expect(result.current.getStrokes()).toHaveLength(0)
  })

  it('不取消笔的 pointerdown —— 否则原始采样流会被掐断', () => {
    // Chrome stops delivering the raw digitiser samples once a pointer event is
    // cancelled. Gestures are prevented by `touch-action: none` instead.
    renderHook(() => useInkSurface({ mode: 'pen', scope: 'document', active: true }))

    const down = pointerEvent('pointerdown', {
      pointerType: 'pen',
      pointerId: 3,
      clientX: 10,
      clientY: 10,
    })
    dispatchOnWindow(down)
    expect(down.defaultPrevented).toBe(false)

    // 手势由 touch-action 挡住，而不是靠取消事件
    expect(document.documentElement.style.touchAction).toBe('none')
  })

  it('笔的 pointerdown 也不被取消 —— 否则原始采样流会被掐断', () => {
    // Chrome stops delivering the raw digitiser samples once a pointer event is
    // cancelled. Gestures are prevented by `touch-action: none` instead.
    renderHook(() => useInkSurface({ mode: 'pen', scope: 'document', active: true }))

    const penDown = pointerEvent('pointerdown', {
      pointerType: 'pen',
      pointerId: 3,
      clientX: 10,
      clientY: 10,
    })
    dispatchOnWindow(penDown)
    expect(penDown.defaultPrevented).toBe(false)

    // 手势由 touch-action 挡住，而不是靠取消事件
    expect(document.documentElement.style.touchAction).toBe('none')
  })

  it('笔迹开始与结束会回调，便于在此期间锁住页面手势', () => {
    const started: string[] = []
    const ended: string[] = []

    renderHook(() =>
      useInkSurface({
        mode: 'pen',
        scope: 'document',
        active: true,
        onStrokeStart: (type) => started.push(type),
        onStrokeEnd: (type) => ended.push(type),
      }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 5, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointerup', { pointerType: 'pen', pointerId: 5, clientX: 40, clientY: 40 }),
    )

    expect(started).toEqual(['pen'])
    expect(ended).toEqual(['pen'])
  })

  it('浏览器中断笔画后，下一次落笔会接着画而不是另起一笔', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 6, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 6, clientX: 30, clientY: 30 }),
    )
    // 浏览器把手势接管，掐断了这一笔
    dispatchOnWindow(
      pointerEvent('pointercancel', { pointerType: 'pen', pointerId: 6, clientX: 30, clientY: 30 }),
    )

    expect(result.current.getStrokes()).toHaveLength(1)

    // 用户继续写：应该接着同一笔
    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 7, clientX: 50, clientY: 50 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 7, clientX: 70, clientY: 70 }),
    )

    const strokes = result.current.getStrokes()
    // 仍然只有一笔（没有断成两截）
    expect(strokes).toHaveLength(1)
    expect(strokes[0].points.length).toBeGreaterThanOrEqual(4)
  })

  it('绘制过程中绝不取消 pointermove（否则浏览器会停止投递数位板采样）', () => {
    renderHook(() => useInkSurface({ mode: 'pen', scope: 'document', active: true }))

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 9, clientX: 10, clientY: 10 }),
    )

    const move = pointerEvent('pointermove', {
      pointerType: 'pen',
      pointerId: 9,
      clientX: 30,
      clientY: 30,
    })
    dispatchOnWindow(move)

    // Chrome stops delivering raw digitiser samples once a pointermove is
    // cancelled — the stroke would then dry up after a couple of points.
    expect(move.defaultPrevented).toBe(false)
  })

  it('覆盖层打开期间页面始终被锁定，笔无法拖动页面', () => {
    // `touch-action` is evaluated when a gesture starts, so the lock has to be
    // in place before the stylus ever lands.
    const { unmount } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    expect(document.documentElement.style.touchAction).toBe('none')

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 20, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 20, clientX: 40, clientY: 40 }),
    )
    dispatchOnWindow(
      pointerEvent('pointerup', { pointerType: 'pen', pointerId: 20, clientX: 40, clientY: 40 }),
    )

    // 笔抬起后仍然锁着 —— 笔随时可能再次落下
    expect(document.documentElement.style.touchAction).toBe('none')

    unmount()
    expect(document.documentElement.style.touchAction).toBe('')
  })

  it('手指始终由应用驱动页面滚动', () => {
    const scrollBy = vi.fn()
    const original = window.scrollBy
    window.scrollBy = scrollBy as typeof window.scrollBy

    try {
      renderHook(() => useInkSurface({ mode: 'pen', scope: 'document', active: true }))

      dispatchOnWindow(
        pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 22, clientX: 10, clientY: 300 }),
      )
      dispatchOnWindow(
        pointerEvent('pointermove', { pointerType: 'touch', pointerId: 22, clientX: 10, clientY: 200 }),
      )

      // 手指上滑 100px → 页面向下滚 100px
      expect(scrollBy).toHaveBeenCalledWith(0, 100)
    } finally {
      window.scrollBy = original
    }
  })

  it('pointerdown 被浏览器取消后，移动事件依然能画出笔迹', () => {
    // The browser may cancel the pointerdown (a palm gesture, for example).
    // Drawing is driven by the moves, so the ink is never lost.
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 30, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointercancel', { pointerType: 'pen', pointerId: 30, clientX: 10, clientY: 10 }),
    )

    // 只有移动事件，没有新的 pointerdown
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 30, clientX: 40, clientY: 40 }),
    )

    const strokes = result.current.getStrokes()
    expect(strokes.length).toBeGreaterThan(0)
    expect(strokes[0].points.length).toBeGreaterThanOrEqual(2)
  })

  it('pointerrawupdate 也能驱动绘制（原始数位板采样流）', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    // 只有原始采样，没有 pointermove
    dispatchOnWindow(
      pointerEvent('pointerrawupdate', {
        pointerType: 'pen',
        pointerId: 40,
        clientX: 10,
        clientY: 10,
      }),
    )
    dispatchOnWindow(
      pointerEvent('pointerrawupdate', {
        pointerType: 'pen',
        pointerId: 40,
        clientX: 60,
        clientY: 60,
      }),
    )

    // 抬起会强制刷新统计（平时是 10fps 节流）
    dispatchOnWindow(
      pointerEvent('pointerup', { pointerType: 'pen', pointerId: 40, clientX: 60, clientY: 60 }),
    )

    const strokes = result.current.getStrokes()
    expect(strokes).toHaveLength(1)
    expect(strokes[0].points.length).toBeGreaterThanOrEqual(2)
    expect(result.current.stats.raw).toBe(2)
  })

  it('悬停（未按下）不产生笔迹', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointermove', {
        pointerType: 'pen',
        pointerId: 31,
        clientX: 10,
        clientY: 10,
        buttons: 0,
      }),
    )

    expect(result.current.getStrokes()).toHaveLength(0)
  })

  it('画布偏移时笔迹仍钉在屏幕上（补偿 position: fixed 失效）', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    // 挂一个真实的画布，并模拟它被页面带着下移了 150px
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 150, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 150 }) as DOMRect
    result.current.attachCanvas(canvas)

    try {
      dispatchOnWindow(
        pointerEvent('pointerdown', {
          pointerType: 'pen',
          pointerId: 50,
          clientX: 100,
          clientY: 300,
        }),
      )

      const strokes = result.current.getStrokes()
      // 存储的坐标恒等于「屏幕坐标」：画布漂移了 150 也被补偿掉
      expect(strokes[0].points[0].x).toBe(100)
      expect(strokes[0].points[0].y).toBe(300)
    } finally {
      canvas.remove()
    }
  })

  it('组件重挂载后笔迹不会丢失', () => {
    // The strokes live outside the React tree precisely so that a remount
    // (which recreates the canvas empty) cannot lose them.
    const first = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true, surfaceId: 'remount-test' }),
    )
    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 60, clientX: 100, clientY: 100 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 60, clientX: 140, clientY: 140 }),
    )
    expect(first.result.current.getStrokes()).toHaveLength(1)
    first.unmount()

    // 重新挂载：笔画仍在
    const second = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true, surfaceId: 'remount-test' }),
    )
    expect(second.result.current.getStrokes()).toHaveLength(1)
    expect(second.result.current.getStrokes()[0].points.length).toBe(2)
  })

  it('统计计数器记录各类事件', () => {
    const { result } = renderHook(() =>
      useInkSurface({ mode: 'pen', scope: 'document', active: true }),
    )

    dispatchOnWindow(
      pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 8, clientX: 10, clientY: 10 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 8, clientX: 30, clientY: 30 }),
    )
    dispatchOnWindow(
      pointerEvent('pointermove', { pointerType: 'pen', pointerId: 8, clientX: 50, clientY: 50 }),
    )
    dispatchOnWindow(
      pointerEvent('pointerup', { pointerType: 'pen', pointerId: 8, clientX: 50, clientY: 50 }),
    )

    expect(result.current.stats.down).toBe(1)
    expect(result.current.stats.move).toBe(2)
    expect(result.current.stats.up).toBe(1)
    expect(result.current.stats.cancel).toBe(0)
    expect(result.current.stats.strokes).toBe(1)
    expect(result.current.stats.points).toBe(3)
  })
})
