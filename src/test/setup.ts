import 'fake-indexeddb/auto'

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
