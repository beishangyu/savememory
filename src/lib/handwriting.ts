/**
 * Handwriting (stylus) helpers.
 *
 * The pure logic lives here so it can be unit-tested without a real canvas:
 * pointer acceptance (palm rejection), pressure → width mapping, and stroke
 * rendering.
 */

/** A single sampled point of a stroke. */
export interface StrokePoint {
  /** Canvas coordinates in CSS pixels. */
  x: number
  y: number
  /** 0..1. Falls back to 0.5 when the device reports nothing. */
  pressure: number
  /** Timestamp in milliseconds. */
  t: number
}

export interface Stroke {
  points: StrokePoint[]
}

/**
 * Which pointers are allowed to draw.
 *
 * `auto`    — a stylus or mouse always draws; a finger draws too, until a
 *             stylus shows up.
 * `pen`     — **only a stylus** draws. Everything else — fingers, mice — is
 *             left completely alone, so the finger keeps scrolling and
 *             tapping while the stylus writes.
 * `finger`  — a finger may draw as well.
 *
 * Why "pen" means "only `pointerType === 'pen'`": the requirement is that a
 * finger must never leave ink, and a finger is the one pointer we can be
 * certain about. Devices that report their stylus as `mouse` can use the
 * `auto` mode instead, which accepts both.
 */
export type PointerMode = 'auto' | 'pen' | 'finger'

export const POINTER_MODE_LABEL: Record<PointerMode, string> = {
  auto: '自动',
  pen: '仅手写笔',
  finger: '手指也能写',
}

/**
 * Should this pointer be allowed to draw?
 *
 * The important rule is palm rejection: in `pen` mode nothing but a stylus may
 * draw, because on a tablet a resting palm looks exactly like a finger. The
 * finger is simply not accepted here, so the browser keeps scrolling the page
 * and the finger keeps working as a finger.
 */
export function shouldAcceptPointer(
  pointerType: string,
  mode: PointerMode,
  penDetected: boolean,
): boolean {
  if (mode === 'finger') return true
  if (mode === 'pen') return pointerType === 'pen'
  // auto: a stylus or mouse always wins; a finger only joins in while no
  // stylus has been seen.
  if (pointerType === 'pen' || pointerType === 'mouse') return true
  return !penDetected
}

/**
 * Does this browser support Pointer Events?
 *
 * If it does not we fall back to Touch Events plus mouse events.
 */
export function supportsPointerEvents(): boolean {
  return typeof window !== 'undefined' && 'PointerEvent' in window
}

/**
 * Guess whether a Touch object comes from a stylus.
 *
 * Only used on the Touch Events fallback path (browsers without Pointer
 * Events). Styluses report real, varying pressure; fingers report a constant
 * 0 or 1.
 */
export function touchLooksLikeStylus(touch: { force: number }): boolean {
  return touch.force > 0 && touch.force < 1
}

/** Map pen pressure onto a line width. */
export function strokeWidthForPressure(
  pressure: number,
  baseWidth: number,
  maxWidth: number,
): number {
  const p = Number.isFinite(pressure) && pressure > 0 ? Math.min(1, pressure) : 0.5
  return baseWidth + (maxWidth - baseWidth) * p
}

/**
 * Apply the user's pressure-sensitivity setting to the width range.
 *
 * `strength` 0 means every stroke has the same width (pressure ignored),
 * 1 means the full base→max range is used.
 */
export function applyPressureStrength(
  baseWidth: number,
  maxWidth: number,
  strength: number,
): number {
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1
  return baseWidth + (maxWidth - baseWidth) * s
}

/** Ink colours offered by the picker. */
export const INK_PALETTE = [
  '#e6e9ef',
  '#6d8cff',
  '#36cfc9',
  '#3fb950',
  '#ffd43b',
  '#ff922b',
  '#f85149',
  '#ff7eb6',
] as const

export const DEFAULT_INK_COLOR = INK_PALETTE[0]

export interface DrawOptions {
  color: string
  baseWidth: number
  maxWidth: number
}

/**
 * Render the strokes onto a 2D context.
 *
 * Each segment is stroked with the average of the two end widths, and round
 * caps make consecutive segments blend into one continuous, pressure-varying
 * line. Drawing segments (rather than one filled circle per sample) keeps the
 * cost linear in the number of samples — important because the whole stroke is
 * re-rendered on every pointer move.
 */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  options: DrawOptions,
): void {
  const widthAt = (point: StrokePoint) =>
    strokeWidthForPressure(point.pressure, options.baseWidth, options.maxWidth)

  ctx.fillStyle = options.color
  ctx.strokeStyle = options.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const stroke of strokes) {
    const points = stroke.points
    if (points.length === 0) continue

    if (points.length === 1) {
      // A tap without movement: a single dot.
      const width = widthAt(points[0])
      ctx.beginPath()
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]
      const current = points[i]
      ctx.beginPath()
      ctx.lineWidth = (widthAt(previous) + widthAt(current)) / 2
      ctx.moveTo(previous.x, previous.y)
      ctx.lineTo(current.x, current.y)
      ctx.stroke()
    }
  }
}

/** Clear the whole drawing area. */
export function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
}

/**
 * Export the canvas as a PNG blob.
 *
 * Returns `null` when the environment cannot rasterise a canvas (e.g. a test
 * runner) so callers can degrade instead of crashing.
 */
export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    // If the platform cannot give us a 2D context it cannot rasterise either.
    // Detect that up front: some environments implement `toBlob` but never
    // call the callback, which would leave us hanging forever.
    let context: CanvasRenderingContext2D | null = null
    try {
      context = canvas.getContext('2d')
    } catch {
      context = null
    }
    if (!context) return null

    if (typeof canvas.toBlob !== 'function') return null

    return await new Promise<Blob | null>((resolve) => {
      let settled = false
      const finish = (blob: Blob | null) => {
        if (settled) return
        settled = true
        resolve(blob)
      }

      const timer = setTimeout(() => finish(null), 5000)
      try {
        canvas.toBlob((result) => {
          clearTimeout(timer)
          finish(result)
        }, 'image/png')
      } catch {
        clearTimeout(timer)
        finish(null)
      }
    })
  } catch {
    return null
  }
}

/** Convert a blob into a base64 payload usable by the model APIs. */
export async function blobToBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  const mimeType = blob.type || 'image/png'
  return { base64: btoa(binary), mimeType }
}
