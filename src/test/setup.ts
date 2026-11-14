import 'fake-indexeddb/auto'
import { beforeEach } from 'vitest'
import { useInk } from '../store/ink'
import { DEFAULT_INK_COLOR } from '../lib/handwriting'
import { resetAllInkSurfaces } from '../hooks/useInkSurface'

/**
 * jsdom's `Blob` class is not clonable by Node's `structuredClone`, which
 * fake-indexeddb uses to store values. Without a workaround the image bytes
 * would be silently dropped on the way into IndexedDB, so the jsdom test
 * environment would not exercise the real code path.
 *
 * Real browsers are unaffected — this only makes jsdom behave like a browser.
 */
const nativeClone = globalThis.structuredClone?.bind(globalThis)

function cloneValue(value: unknown): unknown {
  if (value instanceof Blob) return value
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        out[key] = cloneValue(item)
      }
      return out
    }
  }
  return nativeClone ? nativeClone(value) : value
}

if (typeof window !== 'undefined' && typeof nativeClone === 'function') {
  globalThis.structuredClone = ((value: unknown) => cloneValue(value)) as typeof structuredClone
}

// Module-level stores are shared inside a test file, so reset them between
// tests — otherwise the global ink overlay stays enabled and leaks into the
// next test.
beforeEach(() => {
  // Strokes live in a module-level registry (so a remount cannot lose them),
  // which means they have to be cleared between tests.
  resetAllInkSurfaces()

  useInk.setState({
    enabled: false,
    lastPointerType: '',
    penDetected: false,
    color: DEFAULT_INK_COLOR,
    pressureStrength: 1,
  })

  // The handwriting overlay locks `touch-action` while the stylus is down.
  // Reset it here so a leaked lock cannot affect the next test.
  if (typeof document !== 'undefined') {
    document.documentElement.style.touchAction = ''
    document.body.style.touchAction = ''
    document.body.style.userSelect = ''
    document.body.style.webkitUserSelect = ''
  }
})
