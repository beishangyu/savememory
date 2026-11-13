import { useEffect, useState } from 'react'

/**
 * Reactive CSS media query.
 *
 * Used to swap the top navigation for the bottom tab bar. Rendering only one
 * of them keeps the DOM free of duplicate landmarks (screen readers and tests
 * would otherwise see two "学习" buttons).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)

    setMatches(list.matches)

    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    }
    list.addListener(onChange)
    return () => list.removeListener(onChange)
  }, [query])

  return matches
}

/** The single breakpoint shared by the layout and the CSS. */
export const PHONE_BREAKPOINT = 767
