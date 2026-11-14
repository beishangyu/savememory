/**
 * Build identity.
 *
 * Shown in the UI so it is always obvious which build is running — after a
 * deploy, or while testing a change on a device that may be serving a cached
 * bundle.
 */
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

/** A short, human-readable build label: `v1.0.0 · 2026-11-14 09:30`. */
export function buildLabel(): string {
  if (!BUILD_TIME) return `v${APP_VERSION}`
  const date = BUILD_TIME.slice(0, 16).replace('T', ' ')
  return `v${APP_VERSION} · ${date}`
}
