import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyPressureStrength,
  canvasToBlob,
  clearCanvas,
  drawStrokes,
  shouldAcceptPointer,
  supportsPointerEvents,
  touchLooksLikeStylus,
  type PointerMode,
  type Stroke,
  type StrokePoint,
} from '../lib/handwriting'

/** An in-progress stroke plus the pointer type that is drawing it. */
interface ActiveStroke {
  stroke: Stroke
  pointerType: string
}

/** An in-progress stroke plus the pointer type that is drawing it. */
interface ActiveStroke {
  stroke: Stroke
  pointerType: string
}

/**
 * Strokes live outside the React tree.
 *
 * They are the one piece of state that must survive a remount: a remount
 * recreates the canvas (empty) and any `useRef` would start from scratch,
 * silently losing everything the user had drawn. Keeping the vectors in a
 * module-level registry means the ink can always be redrawn.
 */
interface SurfaceState {
  strokes: Stroke[]
  active: Map<number, ActiveStroke>
  resumable: ActiveStroke | null
}

const surfaces = new Map<string, SurfaceState>()

function surfaceState(id: string): SurfaceState {
  let state = surfaces.get(id)
  if (!state) {
    state = { strokes: [], active: new Map(), resumable: null }
    surfaces.set(id, state)
  }
  return state
}

/** Forget everything drawn on a surface (used when the overlay is closed). */
export function resetInkSurface(id: string): void {
  surfaces.delete(id)
}

/** Forget every surface — used by the test setup. */
export function resetAllInkSurfaces(): void {
  surfaces.clear()
}

/** How many times the surface has been mounted — a remount counter. */
const mountCounts = new Map<string, number>()

export function inkMountCount(id: string): number {
  return mountCounts.get(id) ?? 0
}

export interface InkSurfaceOptions {
  /**
   * Identifies the drawing surface. Strokes are kept per surface so the
   * global overlay and each inline canvas keep their own ink.
   */
  surfaceId?: string  /**
   * Which pointers may draw.
   *
   * In `pen` mode a finger is left alone, so the page keeps scrolling — the
   * finger must not leave ink behind.
   */
  mode: PointerMode
  /**
   * Where the pointer events are captured.
   *
   * `surface` — the canvas element owns the gestures (an inline canvas).
   * `document` — listeners live on the window and the canvas is
   *              `pointer-events: none`, so the page keeps its native
   *              scrolling no matter what the browser does with
   *              `touch-action`. This is what the global overlay uses: it is
   *              the only way to guarantee "the finger scrolls, the stylus
   *              writes" on every vendor's browser.
   */
  scope?: 'surface' | 'document'
  /**
   * Only capture pointers while the surface is active.
   *
   * The global overlay attaches listeners to the window, so it must not listen
   * while it is closed — otherwise every click on the app (including the
   * button that opens it) would leave a stray stroke behind.
   */
  active?: boolean
  inkColor?: string
  /**
   * How strongly the pen pressure affects the line width (0..1).
   * 0 = every stroke has the same width; 1 = the full range.
   */
  pressureStrength?: number
  baseWidth?: number
  maxWidth?: number
  /** Called when a stroke starts / ends (with the pointer type). */
  onStrokeStart?: (pointerType: string) => void
  onStrokeEnd?: (pointerType: string) => void
  /** Called with the current drawing as a PNG blob (null when cleared). */
  onChange?: (blob: Blob | null) => void
}

const DEFAULT_INK = '#e6e9ef'

/**
 * Shared drawing surface logic.
 *
 * Used by both the inline handwriting canvas and the global overlay so the
 * pointer rules — palm rejection, coalesced sampling, multi-pointer strokes —
 * are implemented exactly once.
 */
export interface InkStats {
  /** pointerdown events received. */
  down: number
  /** pointermove events received. */
  move: number
  /** pointerrawupdate events received — the raw digitiser stream. */
  raw: number
  /** pointerup events received. */
  up: number
  /** pointercancel events received — the browser gave up on this pointer. */
  cancel: number
  /** Number of strokes recorded. */
  strokes: number
  /** Total number of sample points recorded. */
  points: number
}

/**
 * Live input statistics.
 *
 * These exist to answer one question precisely: when a stroke stops, *why*?
 * A rising `move` counter with a frozen `points` counter means the events
 * arrive but are dropped; a `cancel` that fires mid-stroke means the browser
 * took the pointer away (a gesture it decided to own).
 */
export function useInkSurface(options: InkSurfaceOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /*
   * The strokes live in a module-level registry, not in a `useRef`.
   *
   * A remount (which happens for reasons outside our control — a re-render of
   * the parent, a portal re-mount, ...) recreates the canvas empty, and a
   * `useRef` would start from scratch and silently lose everything the user
   * had drawn. With the registry the vectors are always recoverable and the
   * ink can be redrawn at any time.
   */
  const surfaceId = options.surfaceId ?? 'default'
  const surfaceIdRef = useRef(surfaceId)
  const surface = useMemo(() => surfaceState(surfaceIdRef.current), [])

  // Count mounts so a remount is visible in the diagnostics.
  useEffect(() => {
    mountCounts.set(surfaceIdRef.current, (mountCounts.get(surfaceIdRef.current) ?? 0) + 1)
  }, [])

  const strokesRef = useRef<Stroke[]>(surface.strokes)
  const activeRef = useRef(surface.active)
  /** A stroke the browser cut short; the next contact continues it. */
  const resumableRef = useRef<ActiveStroke | null>(surface.resumable)
  /**
   * How far the canvas has drifted away from the viewport origin.
   *
   * `position: fixed` is not reliable everywhere (some Android / HarmonyOS
   * browsers let it scroll with the page). Measuring the drift and cancelling
   * it out keeps the ink pinned to the screen on every device.
   */
  const offsetRef = useRef({ x: 0, y: 0 })
  /** The measured drift, exposed so the UI can show it. */
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const penDetectedRef = useRef(false)

  const [strokeCount, setStrokeCount] = useState(0)
  const [penDetected, setPenDetected] = useState(false)
  /** The last pointer type we saw — surfaced in the UI for troubleshooting. */
  const [lastPointerType, setLastPointerType] = useState('')
  /** The canvas size in CSS pixels — surfaced for troubleshooting. */
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** Live input statistics — surfaced for troubleshooting. */
  const [stats, setStats] = useState<InkStats>({
    down: 0,
    move: 0,
    raw: 0,
    up: 0,
    cancel: 0,
    strokes: 0,
    points: 0,
  })
  const statsRef = useRef(stats)
  const lastStatsPushRef = useRef(0)

  /** Push the counters to the UI, at most ten times per second. */
  const pushStats = useCallback((immediate = false) => {
    const now = Date.now()
    if (!immediate && now - lastStatsPushRef.current < 100) return
    lastStatsPushRef.current = now
    setStats({ ...statsRef.current })
  }, [])

  // Keep the latest options without re-creating the handlers on every render.
  const optionsRef = useRef(options)
  optionsRef.current = options

  const scope = options.scope ?? 'surface'
  /** Only capture pointers while the surface is active. */
  const active = options.active !== false

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(3, window.devicePixelRatio || 1)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    clearCanvas(ctx, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Compensation for platforms where `position: fixed` does not hold still
    // (known on some Android / HarmonyOS browsers while the page scrolls).
    // The ink is meant to stay pinned to the screen, so whatever drift the
    // canvas picked up is cancelled out here.
    const offset = offsetRef.current
    if (offset.x !== 0 || offset.y !== 0) {
      ctx.translate(offset.x, offset.y)
    }

    const baseWidth = optionsRef.current.baseWidth ?? 2.2
    const maxWidth = optionsRef.current.maxWidth ?? 6.5

    drawStrokes(ctx, strokesRef.current, {
      color: optionsRef.current.inkColor ?? DEFAULT_INK,
      baseWidth,
      maxWidth: applyPressureStrength(
        baseWidth,
        maxWidth,
        optionsRef.current.pressureStrength ?? 1,
      ),
    })
  }, [])

  const emit = useCallback(async () => {
    const onChange = optionsRef.current.onChange
    if (!onChange) return
    const canvas = canvasRef.current
    if (!canvas) {
      onChange(null)
      return
    }
    onChange(await canvasToBlob(canvas))
  }, [])

  /** Keep the backing store in sync with the element's real size. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(3, window.devicePixelRatio || 1)

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    )
    redraw()
  }, [redraw])

  /**
   * Measure how far the canvas has drifted away from the viewport origin.
   *
   * `position: fixed` is not reliable everywhere — on some Android /
   * HarmonyOS browsers the overlay scrolls along with the page. Measuring the
   * drift and cancelling it out keeps the ink pinned to the screen.
   */
  const syncOffset = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const next = { x: -rect.left, y: -rect.top }
    if (next.x === offsetRef.current.x && next.y === offsetRef.current.y) return
    offsetRef.current = next
    setOffset(next)
    redraw()
  }, [redraw])

  const observerRef = useRef<ResizeObserver | null>(null)

  /**
   * Callback ref for the canvas element.
   *
   * A callback ref is used instead of a plain ref because the canvas may be
   * mounted long after the hook (the global overlay only renders it when it is
   * opened). With a plain ref the sizing effect would have run while the
   * element did not exist yet, leaving the backing store at its default
   * 300x150 — and every stroke outside that tiny area would be invisible.
   */
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      canvasRef.current = node

      if (!node) return

      resize()
      syncOffset()

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          resize()
          syncOffset()
        })
        observer.observe(node)
        observerRef.current = observer
      }
    },
    [resize, syncOffset],
  )

  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [resize])

  // Re-render the existing strokes when the style changes — the strokes are
  // kept as vectors, so switching colour or pressure re-draws them instantly.
  const inkColor = options.inkColor
  const pressureStrength = options.pressureStrength
  useEffect(() => {
    redraw()
  }, [inkColor, pressureStrength, redraw])

  const toPoint = useCallback(
    (clientX: number, clientY: number, pressure: number, timeStamp: number): StrokePoint => {
      const canvas = canvasRef.current
      const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 }
      // The stored coordinates are always "where the ink sits on the screen".
      // The canvas' own drift is compensated for on both sides, so the ink
      // stays put even where `position: fixed` misbehaves.
      const offset = offsetRef.current
      return {
        x: clientX - rect.left - offset.x,
        y: clientY - rect.top - offset.y,
        // Some devices report 0 pressure for a hovering stylus; treat it as mid.
        pressure: pressure > 0 ? pressure : 0.5,
        t: timeStamp,
      }
    },
    [],
  )

  /**
   * Collect the sample points of a pointer event.
   *
   * `getCoalescedEvents()` returns every sample the digitiser captured since
   * the previous event. Without it a fast stroke only gets one point per
   * animation frame, and the gaps between them turn the line into a dotted
   * one.
   */
  const pointsFromEvent = useCallback(
    (event: PointerEvent): StrokePoint[] => {
      const samples =
        typeof event.getCoalescedEvents === 'function' && event.getCoalescedEvents().length > 0
          ? event.getCoalescedEvents()
          : [event]

      return samples.map((sample) =>
        toPoint(sample.clientX, sample.clientY, sample.pressure, sample.timeStamp),
      )
    },
    [toPoint],
  )

  const accepts = useCallback((pointerType: string) => {
    return shouldAcceptPointer(pointerType, optionsRef.current.mode, penDetectedRef.current)
  }, [])

  /**
   * Create a stroke, or continue the one the browser cut short.
   *
   * Returns the active stroke, or `null` when the pointer may not draw.
   */
  const startStroke = useCallback(
    (id: number, pointerType: string, point: StrokePoint): ActiveStroke | null => {
      if (!accepts(pointerType)) return null

      if (pointerType === 'pen' && !penDetectedRef.current) {
        penDetectedRef.current = true
        setPenDetected(true)
      }

      // A stroke the browser cut short is continued rather than restarted, so
      // the user does not end up with a detached fragment.
      const resumable = resumableRef.current
      if (resumable && resumable.pointerType === pointerType) {
        resumableRef.current = null
        resumable.stroke.points.push(point)
        statsRef.current.points += 1
        activeRef.current.set(id, resumable)
        optionsRef.current.onStrokeStart?.(pointerType)
        redraw()
        return resumable
      }

      const stroke: Stroke = { points: [point] }
      strokesRef.current.push(stroke)
      const entry: ActiveStroke = { stroke, pointerType }
      activeRef.current.set(id, entry)
      statsRef.current.strokes += 1
      statsRef.current.points += 1
      setStrokeCount(strokesRef.current.length)
      optionsRef.current.onStrokeStart?.(pointerType)
      redraw()
      return entry
    },
    [accepts, redraw],
  )

  const beginStroke = useCallback(
    (id: number, pointerType: string, point: StrokePoint) => {
      return startStroke(id, pointerType, point) !== null
    },
    [startStroke],
  )

  const extendStroke = useCallback(
    (stroke: Stroke, pointerType: string, point: StrokePoint) => {
      if (!accepts(pointerType)) return false
      stroke.points.push(point)
      statsRef.current.points += 1
      redraw()
      return true
    },
    [accepts, redraw],
  )

  /**
   * Find the stroke a pointer event belongs to.
   *
   * The pointer id is normally stable for the whole contact, but some browsers
   * report a different id between `pointerdown` and `pointermove` for a
   * stylus. When that happens the event is matched against the single active
   * stroke with the same pointer type instead of being dropped — otherwise the
   * stroke would stop right after its first point.
   */
  const findActive = useCallback(
    (pointerId: number, pointerType: string): ActiveStroke | undefined => {
      const direct = activeRef.current.get(pointerId)
      if (direct) return direct

      const candidates = [...activeRef.current.values()].filter(
        (entry) => entry.pointerType === pointerType,
      )
      return candidates.length === 1 ? candidates[0] : undefined
    },
    [],
  )

  const endStroke = useCallback(
    (id: number, reason: 'up' | 'cancel' = 'up') => {
      const entry = activeRef.current.get(id)
      if (!entry) return
      if (reason === 'cancel') {
        // The browser took the pointer away mid-stroke (usually a gesture it
        // decided to own). Keep the stroke alive — any further moves still
        // extend it — and remember it so the next contact continues the same
        // stroke instead of leaving a gap.
        resumableRef.current = entry
        optionsRef.current.onStrokeEnd?.(entry.pointerType)
        void emit()
        return
      }

      activeRef.current.delete(id)
      setStrokeCount(strokesRef.current.length)
      optionsRef.current.onStrokeEnd?.(entry.pointerType)
      void emit()
    },
    [emit],
  )
  /* ---------------------------------------------------------------- *
   * Surface scope: React handlers on the canvas element.
   * ---------------------------------------------------------------- */

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = toPoint(
        event.nativeEvent.clientX,
        event.nativeEvent.clientY,
        event.nativeEvent.pressure,
        event.nativeEvent.timeStamp,
      )
      if (beginStroke(event.pointerId, event.pointerType, point)) {
        // No `preventDefault()`: cancelling a pointer event can stop the
        // browser from delivering further digitiser samples. Scrolling and
        // text selection are prevented with `touch-action: none` and
        // `user-select: none` instead.
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture is not available everywhere; drawing still works.
        }
      }
    },
    [beginStroke, toPoint],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const entry = findActive(event.pointerId, event.pointerType)
      if (!entry) return

      // No `preventDefault()` here — see the note in the document scope. The
      // inline canvas relies on `touch-action: none` to keep the page still.
      for (const point of pointsFromEvent(event.nativeEvent)) {
        extendStroke(entry.stroke, event.pointerType, point)
      }
    },
    [extendStroke, findActive, pointsFromEvent],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      endStroke(event.pointerId)
    },
    [endStroke],
  )

  /* ---------------------------------------------------------------- *
   * Document scope: window listeners.
   *
   * The canvas is `pointer-events: none`, so the page keeps its native
   * scrolling. A rejected pointer (a finger in pen mode) is left completely
   * alone — no preventDefault — so the browser scrolls the page as usual.
   * ---------------------------------------------------------------- */

  /*
   * Gesture policy for the global overlay.
   *
   * While the stylus is down the page is locked (`touch-action: none`).
   * That protects the pen: a palm resting on the screen would otherwise
   * start a browser gesture, and a gesture takes over — which cancels the
   * *pen's* pointer and cuts the stroke short. The lock is applied when the
   * pen goes down, so it protects every *later* contact (the palm) even
   * though the current gesture has already started.
   *
   * The lock does cost the finger its native scrolling, so during that
   * window the finger scrolls the page itself. Outside the window the browser
   * scrolls natively, momentum and all.
   */
  const lockRef = useRef<{
    touchAction: string
    userSelect: string
    webkitUserSelect: string
  } | null>(null)

  const lockPage = useCallback(() => {
    if (lockRef.current) return
    lockRef.current = {
      touchAction: document.documentElement.style.touchAction,
      userSelect: document.body.style.userSelect,
      webkitUserSelect: document.body.style.webkitUserSelect,
    }
    document.documentElement.style.touchAction = 'none'
    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'
  }, [])

  const unlockPage = useCallback(() => {
    const saved = lockRef.current
    if (!saved) return
    lockRef.current = null
    document.documentElement.style.touchAction = saved.touchAction
    document.body.style.userSelect = saved.userSelect
    document.body.style.webkitUserSelect = saved.webkitUserSelect
  }, [])

  /** Scroll the page by hand — used while the page is locked. */
  const scrollBy = useCallback((delta: number) => {
    if (delta === 0) return
    try {
      window.scrollBy(0, delta)
    } catch {
      // Not every environment implements scrolling.
    }
  }, [])

  useEffect(() => {
    if (scope !== 'document' || !active) return

    /*
     * Gesture policy for the global overlay.
     *
     * The page is locked for as long as the overlay is open, not just while
     * the stylus is down. `touch-action` is evaluated by the browser when a
     * gesture *starts*, so locking it inside the pointerdown handler would be
     * too late for that very stroke — the stylus could still drag the page.
     *
     * Locking it up front means:
     *  - the stylus can never scroll the page, and
     *  - a palm can never start a gesture that would cancel the stylus.
     *
     * The finger keeps scrolling — the application drives it itself (with a
     * bit of inertia), because the browser's own scrolling is disabled while
     * the page is locked.
     */
    lockPage()

    let fingerY: number | null = null
    let velocity = 0
    let inertiaFrame = 0

    const stopInertia = () => {
      if (inertiaFrame) {
        cancelAnimationFrame(inertiaFrame)
        inertiaFrame = 0
      }
    }

    const startInertia = () => {
      stopInertia()
      if (Math.abs(velocity) < 1) {
        velocity = 0
        return
      }
      const step = () => {
        velocity *= 0.94
        if (Math.abs(velocity) < 0.5) {
          inertiaFrame = 0
          velocity = 0
          return
        }
        scrollBy(velocity)
        inertiaFrame = requestAnimationFrame(step)
      }
      inertiaFrame = requestAnimationFrame(step)
    }

    /*
     * The raw digitiser stream.
     *
     * `pointerrawupdate` fires for every sample the digitiser captured. It is
     * not frame-rate limited, and — crucially — it is not affected when the
     * browser cancels the pointer (a palm gesture, for instance). Some
     * devices deliver only a couple of `pointermove` events per contact before
     * the pointer is cancelled, which is why the ink used to come out as a few
     * straight lines between distant points.
     *
     * It does not bubble, so the listener has to be registered in the capture
     * phase.
     */
    const supportsRawUpdate =
      typeof window !== 'undefined' && 'onpointerrawupdate' in window
    /** When a raw update was last handled, per pointer id. */
    const rawSeenAt = new Map<number, number>()

    /*
     * Keep track of how far the canvas has drifted away from the viewport
     * origin. On devices where `position: fixed` scrolls with the page, the
     * ink would otherwise be dragged along with it.
     */
    const onScroll = () => syncOffset()

    const addSample = (event: PointerEvent) => {
      if (event.pointerType !== 'pen') return
      // Hovering is not drawing.
      if (event.buttons === 0) return

      let entry = findActive(event.pointerId, event.pointerType)
      let justStarted = false

      if (!entry) {
        const point = toPoint(
          event.clientX,
          event.clientY,
          event.pressure,
          event.timeStamp,
        )
        const started = startStroke(event.pointerId, event.pointerType, point)
        if (!started) return
        entry = started
        justStarted = true
      }

      const samples = pointsFromEvent(event)
      samples.forEach((point, index) => {
        if (justStarted && index === 0) return
        extendStroke(entry!.stroke, event.pointerType, point)
      })
    }

    const onRawUpdate = (event: PointerEvent) => {
      if (event.pointerType !== 'pen') return
      statsRef.current.raw += 1
      rawSeenAt.set(event.pointerId, Date.now())
      pushStats()
      addSample(event)
    }

    const onDown = (event: PointerEvent) => {
      statsRef.current.down += 1
      pushStats(true)
      setLastPointerType(event.pointerType)

      if (event.pointerType === 'touch') {
        // A finger never draws in the global overlay; it only scrolls.
        fingerY = event.clientY
        return
      }

      const point = toPoint(
        event.clientX,
        event.clientY,
        event.pressure,
        event.timeStamp,
      )
      // No `preventDefault()` anywhere in the drawing path.
      //
      // Cancelling a pointer event makes Chrome stop delivering the raw
      // digitiser samples for that pointer, so the stroke would dry up to a
      // couple of points. The page is already locked with `touch-action: none`
      // for the whole lifetime of the overlay, which is what stops the browser
      // from stealing the stylus — so no cancellation is needed here.
      beginStroke(event.pointerId, event.pointerType, point)
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        // While the page is locked the finger drives the scroll itself, so it
        // keeps working exactly as it does without the overlay.
        //
        // No `preventDefault()`: the page is already locked with
        // `touch-action: none`, so the browser does not scroll anyway — and
        // cancelling a pointer event can silence the raw sample stream.
        const previous = fingerY
        if (previous !== null) {
          const delta = previous - event.clientY
          fingerY = event.clientY
          if (delta !== 0) {
            velocity = velocity * 0.7 + delta * 0.3
            scrollBy(delta)
          }
        }
        return
      }

      statsRef.current.move += 1
      pushStats()

      // If the raw stream is already covering this pointer, the plain move
      // event would only duplicate its samples.
      const lastRaw = rawSeenAt.get(event.pointerId)
      if (lastRaw !== undefined && Date.now() - lastRaw < 100) return

      addSample(event)
    }

    const onUp = (event: PointerEvent) => {
      statsRef.current.up += 1
      pushStats(true)
      if (event.pointerType === 'touch') {
        fingerY = null
        velocity = 0
        startInertia()
        return
      }
      endStroke(event.pointerId)
    }

    const onCancel = (event: PointerEvent) => {
      statsRef.current.cancel += 1
      pushStats(true)
      if (event.pointerType === 'touch') {
        fingerY = null
        velocity = 0
        startInertia()
        return
      }
      // The browser took the pointer away mid-stroke (usually a gesture it
      // decided to own). Keep the stroke alive — any further moves still
      // extend it — and remember it so the next contact continues the same
      // stroke instead of leaving a gap.
      endStroke(event.pointerId, 'cancel')
    }

    window.addEventListener('pointerdown', onDown, { passive: false })
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    // `pointerrawupdate` does not bubble, so it needs the capture phase.
    if (supportsRawUpdate) {
      window.addEventListener('pointerrawupdate', onRawUpdate as EventListener, true)
    }
    // Capture phase so that scrolling inner containers is caught as well.
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (supportsRawUpdate) {
        window.removeEventListener('pointerrawupdate', onRawUpdate as EventListener, true)
      }
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      unlockPage()
    }
  }, [
    scope,
    active,
    beginStroke,
    extendStroke,
    endStroke,
    findActive,
    toPoint,
    pushStats,
    lockPage,
    unlockPage,
    scrollBy,
    startStroke,
  ])

  /**
   * Fallback for browsers without Pointer Events: Touch Events + mouse.
   */
  useEffect(() => {
    if (scope !== 'document' || !active) return
    if (supportsPointerEvents()) return

    let mouseId = -1
    let fingerY: number | null = null

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      if (!touch) return
      setLastPointerType('touch')
      const kind = touchLooksLikeStylus(touch) ? 'pen' : 'touch'
      if (kind === 'touch') {
        // A finger never draws in the global overlay; it only scrolls.
        fingerY = touch.clientY
        return
      }
      const point = toPoint(touch.clientX, touch.clientY, touch.force, event.timeStamp)
      // No preventDefault: it would stop the page from scrolling and would
      // suppress focus. See the pointerdown handler above.
      if (beginStroke(touch.identifier, kind, point)) {
        lockPage()
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      if (!touch) return
      const kind = touchLooksLikeStylus(touch) ? 'pen' : 'touch'
      if (kind === 'touch') {
        const previous = fingerY
        if (previous !== null && lockRef.current) {
          const delta = previous - touch.clientY
          fingerY = touch.clientY
          if (delta !== 0) {
            scrollBy(delta)
            event.preventDefault()
          }
        }
        return
      }
      const entry = findActive(touch.identifier, kind)
      if (!entry) return
      const point = toPoint(touch.clientX, touch.clientY, touch.force, event.timeStamp)
      if (extendStroke(entry.stroke, kind, point)) {
        event.preventDefault()
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      if (!touch) return
      fingerY = null
      unlockPage()
      endStroke(touch.identifier)
    }

    const onMouseDown = (event: MouseEvent) => {
      setLastPointerType('mouse')
      const point = toPoint(event.clientX, event.clientY, 0.5, event.timeStamp)
      beginStroke(mouseId, 'mouse', point)
    }

    const onMouseMove = (event: MouseEvent) => {
      const entry = findActive(mouseId, 'mouse')
      if (!entry) return
      const point = toPoint(event.clientX, event.clientY, 0.5, event.timeStamp)
      if (extendStroke(entry.stroke, 'mouse', point)) event.preventDefault()
    }
    const onMouseUp = () => endStroke(mouseId)

    document.addEventListener('touchstart', onTouchStart, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('touchcancel', onTouchEnd)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      unlockPage()
    }
  }, [
    scope,
    active,
    beginStroke,
    extendStroke,
    endStroke,
    findActive,
    toPoint,
    lockPage,
    unlockPage,
    scrollBy,
  ])

  const undo = useCallback(() => {
    // Drop the last *finished* stroke; an in-progress one is still active.
    const inProgress = new Set(
      Array.from(activeRef.current.values()).map((entry) => entry.stroke),
    )
    for (let i = strokesRef.current.length - 1; i >= 0; i -= 1) {
      const stroke = strokesRef.current[i]
      if (!inProgress.has(stroke)) {
        strokesRef.current.splice(i, 1)
        break
      }
    }
    setStrokeCount(strokesRef.current.length)
    redraw()
    void emit()
  }, [emit, redraw])

  const clear = useCallback(() => {
    strokesRef.current.length = 0
    activeRef.current.clear()
    resumableRef.current = null
    setStrokeCount(0)
    // The counters describe the current drawing, so they reset with it.
    statsRef.current = {
      down: 0,
      move: 0,
      raw: 0,
      up: 0,
      cancel: 0,
      strokes: 0,
      points: 0,
    }
    setStats({ ...statsRef.current })
    redraw()
    void emit()
  }, [emit, redraw])

  /** The current drawing as a PNG blob (null when there is nothing to save). */
  const toBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvasToBlob(canvas)
  }, [])

  /** The strokes as vectors — the same data the canvas is drawn from. */
  const getStrokes = useCallback(() => strokesRef.current, [])

  /** How many times this surface has been mounted. */
  const mountCount = inkMountCount(surfaceIdRef.current)

  return {
    /** Attach to the canvas element: `ref={attachCanvas}`. */
    attachCanvas,
    strokeCount,
    penDetected,
    lastPointerType,
    size,
    offset,
    stats,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    undo,
    clear,
    toBlob,
    getStrokes,
    mountCount,
  }
}
