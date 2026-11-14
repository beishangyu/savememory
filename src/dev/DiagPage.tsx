/**
 * On-device diagnostics.
 *
 * Input behaviour (stylus support, `position: fixed` reliability, event
 * delivery rates) differs wildly between tablet vendors and cannot be
 * reproduced on a desktop. This page records the raw event stream on the device
 * and posts it to the development machine, so the behaviour can be inspected
 * where it actually happens.
 *
 * Only reachable with `#diag` in the URL, and only in development builds.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInk } from '../store/ink'
import { buildLabel } from '../version'

interface DiagSample {
  t: number
  kind: string
  pointerType?: string
  pointerId?: number
  buttons?: number
  pressure?: number
  clientX?: number
  clientY?: number
  pageX?: number
  pageY?: number
  scrollY?: number
  canvasTop?: number
  canvasLeft?: number
  canvasH?: number
  canvasW?: number
  inkScreenY?: number | null
  /** Screen position of the real global overlay's ink (centroid). */
  overlayInkY?: number | null
  /** How many pixels of the real overlay's canvas are inked. */
  overlayInkPixels?: number
}

const MAX_SAMPLES = 4000

export function DiagPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const samplesRef = useRef<DiagSample[]>([])
  const [recording, setRecording] = useState(false)
  const [count, setCount] = useState(0)
  const [status, setStatus] = useState('')
  const [summary, setSummary] = useState<Record<string, string>>({})
  const inkEnabled = useInk((state) => state.enabled)
  const toggleInk = useInk((state) => state.toggle)

  /**
   * Draw a horizontal reference line on a dedicated canvas and report where
   * it ends up on screen. This answers the question directly: does the ink
   * stay put when the page scrolls?
   */
  const measureInk = useCallback((): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const dpr = Math.min(3, window.devicePixelRatio || 1)

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 8) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          // Canvas pixel → CSS pixel → screen position.
          return y / dpr + canvas.getBoundingClientRect().top
        }
      }
    }
    return null
  }, [])

  /**
   * Measure where the ink of the *real* global overlay currently sits on
   * screen.
   *
   * Every pixel is scanned (no sampling): a thin or short stroke would be
   * skipped by a strided scan and the measurement would then report some
   * *other* stroke's position. The centroid is used as the position because it
   * is stable when more strokes are added.
   */
  const measureOverlayInk = useCallback((): number | null => {
    const canvas = document.querySelector('canvas.ink-overlay') as HTMLCanvasElement | null
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const dpr = Math.min(3, window.devicePixelRatio || 1)

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let sumY = 0
    let count = 0
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          sumY += y
          count += 1
        }
      }
    }
    if (count === 0) return null
    return sumY / count / dpr + canvas.getBoundingClientRect().top
  }, [])

  /** Total number of inked pixels — a robust "is the ink still there" metric. */
  const countOverlayInk = useCallback((): number => {
    const canvas = document.querySelector('canvas.ink-overlay') as HTMLCanvasElement | null
    if (!canvas) return 0
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) count += 1
    }
    return count
  }, [])

  const push = useCallback((sample: DiagSample) => {
    const list = samplesRef.current
    list.push(sample)
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES)
    setCount(list.length)
  }, [])

  const start = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        // A reference line at a known canvas position.
        ctx.fillStyle = '#ff922b'
        ctx.fillRect(0, 200, window.innerWidth, 3)
      }
    }

    samplesRef.current = []
    setCount(0)
    setStatus('采集中…请用笔写字，然后用手指滑动页面')

    const record = (kind: string, event?: PointerEvent | TouchEvent | Event) => {
      // Measure the real overlay when it is open; fall back to the reference
      // canvas otherwise.
      const overlay = document.querySelector('canvas.ink-overlay') as HTMLCanvasElement | null
      const canvas = overlay ?? canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      const pointer = event as PointerEvent
      const isPointer = 'pointerType' in (event ?? {})

      push({
        t: Math.round(performance.now()),
        kind,
        pointerType: isPointer ? pointer.pointerType : 'touch',
        pointerId: isPointer ? pointer.pointerId : undefined,
        buttons: isPointer ? pointer.buttons : undefined,
        pressure: isPointer ? pointer.pressure : undefined,
        clientX: isPointer ? pointer.clientX : undefined,
        clientY: isPointer ? pointer.clientY : undefined,
        pageX: isPointer ? pointer.pageX : undefined,
        pageY: isPointer ? pointer.pageY : undefined,
        scrollY: Math.round(window.scrollY),
        canvasTop: rect ? Math.round(rect.top) : undefined,
        canvasLeft: rect ? Math.round(rect.left) : undefined,
        canvasH: rect ? Math.round(rect.height) : undefined,
        canvasW: rect ? Math.round(rect.width) : undefined,
        inkScreenY: measureInk(),
        overlayInkY: overlay ? measureOverlayInk() : undefined,
        overlayInkPixels: overlay ? countOverlayInk() : undefined,
      })
    }

    const onPointer = (event: PointerEvent) => {
      record(event.type, event)
    }
    const onRaw = (event: Event) => {
      record('pointerrawupdate', event as PointerEvent)
    }
    const onScroll = () => {
      record('scroll')
    }
    const onTouch = (event: TouchEvent) => {
      record(`touch${event.type.replace('touch', '')}`, event as unknown as PointerEvent)
    }

    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('pointermove', onPointer, true)
    window.addEventListener('pointerup', onPointer, true)
    window.addEventListener('pointercancel', onPointer, true)
    window.addEventListener('pointerrawupdate', onRaw, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('touchstart', onTouch, true)
    window.addEventListener('touchmove', onTouch, true)
    window.addEventListener('touchend', onTouch, true)

    ;(window as unknown as { __diagStop?: () => void }).__diagStop = () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('pointermove', onPointer, true)
      window.removeEventListener('pointerup', onPointer, true)
      window.removeEventListener('pointercancel', onPointer, true)
      window.removeEventListener('pointerrawupdate', onRaw, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('touchstart', onTouch, true)
      window.removeEventListener('touchmove', onTouch, true)
      window.removeEventListener('touchend', onTouch, true)
      setRecording(false)
      setStatus('已停止采集')
    }
    setRecording(true)
  }, [push, measureInk])

  const stop = useCallback(() => {
    const fn = (window as unknown as { __diagStop?: () => void }).__diagStop
    fn?.()
  }, [])

  const report = useCallback(async () => {
    setStatus('正在上报…')
    const samples = samplesRef.current
    const inkValues = samples
      .map((sample) => sample.inkScreenY)
      .filter((value): value is number => typeof value === 'number')
    const overlayValues = samples
      .map((sample) => sample.overlayInkY)
      .filter((value): value is number => typeof value === 'number')
    const pixelSamples = samples
      .map((sample) => sample.overlayInkPixels)
      .filter((value): value is number => typeof value === 'number')

    const payload = {
      build: buildLabel(),
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      supports: {
        pointerEvent: 'PointerEvent' in window,
        pointerRawUpdate: 'onpointerrawupdate' in window,
        visualViewport: 'visualViewport' in window,
        maxTouchPoints: navigator.maxTouchPoints,
      },
      ink: {
        samples: inkValues.length,
        min: inkValues.length ? Math.min(...inkValues) : null,
        max: inkValues.length ? Math.max(...inkValues) : null,
        drift: inkValues.length ? Math.max(...inkValues) - Math.min(...inkValues) : null,
      },
      /** Where the real overlay's ink sat on screen, sampled over time. */
      overlayInk: {
        samples: overlayValues.length,
        min: overlayValues.length ? Math.min(...overlayValues) : null,
        max: overlayValues.length ? Math.max(...overlayValues) : null,
        drift: overlayValues.length
          ? Math.max(...overlayValues) - Math.min(...overlayValues)
          : null,
      },
      /** How much ink the real overlay held over time — catches lost strokes. */
      overlayInkPixels: {
        samples: pixelSamples.length,
        min: pixelSamples.length ? Math.min(...pixelSamples) : null,
        max: pixelSamples.length ? Math.max(...pixelSamples) : null,
        final: pixelSamples.length ? pixelSamples[pixelSamples.length - 1] : null,
      },
      /** Where the overlay canvas itself sat — is `position: fixed` holding? */
      overlayCanvas: {
        tops: [...new Set(samples.map((s) => s.canvasTop).filter((v): v is number => v !== undefined))],
      },
      counters: samples.reduce<Record<string, number>>((acc, sample) => {
        const key = sample.pointerType ? `${sample.kind}:${sample.pointerType}` : sample.kind
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
      samples: samples.slice(-1500),
    }

    try {
      const response = await fetch('/__diag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setStatus(response.ok ? '上报成功 ✓' : `上报失败：${response.status}`)
      setSummary({
        构建: payload.build,
        视口: `${payload.viewport.width}×${payload.viewport.height} @${payload.viewport.dpr}x`,
        原始采样: payload.supports.pointerRawUpdate ? '支持' : '不支持',
        视觉视口: payload.supports.visualViewport ? '支持' : '不支持',
        触点数: String(payload.supports.maxTouchPoints),
        参考线漂移: payload.ink.drift === null ? '—' : `${payload.ink.drift.toFixed(1)}px`,
        覆盖层墨迹漂移:
          payload.overlayInk.drift === null ? '—' : `${payload.overlayInk.drift.toFixed(1)}px`,
        覆盖层墨迹像素: `${payload.overlayInkPixels.min ?? '—'} → ${payload.overlayInkPixels.final ?? '—'}`,
        画布top取值: payload.overlayCanvas.tops.join(',') || '—',
        事件: JSON.stringify(payload.counters),
      })
    } catch (error) {
      setStatus(`上报失败：${String(error)}`)
    }
  }, [])

  useEffect(() => {
    return () => stop()
  }, [stop])

  return (
    <div className="page diag-page">
      <header className="page-head">
        <h1>设备诊断</h1>
        <p className="muted">
          采集本机的原始指针与滚动事件，并回传到开发机（写入{' '}
          <code>diag/telemetry.jsonl</code>）。
        </p>
      </header>

      <section className="panel">
        <p>
          <strong>构建：</strong>
          {buildLabel()}
        </p>
        <p className="muted small">
          UA: {navigator.userAgent.slice(0, 120)}
        </p>
        <p className="muted small">
          PointerEvent: {'PointerEvent' in window ? '支持' : '不支持'} ｜ pointerrawupdate:{' '}
          {'onpointerrawupdate' in window ? '支持' : '不支持'} ｜ 触点数:{' '}
          {navigator.maxTouchPoints}
        </p>

        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={start} disabled={recording}>
            开始采集
          </button>
          <button type="button" className="btn" onClick={stop} disabled={!recording}>
            停止
          </button>
          <button type="button" className="btn" onClick={report}>
            上报数据
          </button>
          <button
            type="button"
            className={`btn ${inkEnabled ? 'btn-primary' : ''}`}
            onClick={toggleInk}
          >
            {inkEnabled ? '关闭全局手写' : '打开全局手写'}
          </button>
        </div>

        <div className="alert alert-warn">
          <strong>操作步骤</strong>
          <br />
          1. 点「打开全局手写」（诊断的是真实覆盖层，测出来的就是它的行为）
          <br />
          2. 点「开始采集」
          <br />
          3. 用笔在页面上写几个字
          <br />
          4. 用手指上下滑动页面（看看墨迹是否跟着动）
          <br />
          5. 点「上报数据」
        </div>

        {status && <div className="alert alert-ok">{status}</div>}
        <p className="muted small">已采集 {count} 条事件</p>

        {Object.keys(summary).length > 0 && (
          <pre className="diag-summary">{JSON.stringify(summary, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h2>参考线（橙色）用于测量墨迹是否随页面滚动</h2>
        <p className="muted small">
          橙色横线画在一块与真实覆盖层相同的 fixed 画布上。若这台设备无法把 fixed
          元素固定住，滚动时它会漂移，「墨迹漂移」就会大于 0。
        </p>
        <canvas ref={canvasRef} className="ink-canvas diag-canvas" />
      </section>
    </div>
  )
}
