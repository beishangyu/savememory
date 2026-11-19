import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { ReviewGrade } from '../db/schema'
import { GRADE_ORDER } from '../fsrs/scheduler'
import { useInk } from '../store/ink'

/** Minimum horizontal travel (px) before a swipe counts as a grade. */
const SWIPE_THRESHOLD = 60

/** How far the finger travels before the swipe hint appears. */
const HINT_THRESHOLD = 32

/** A swipe has to be this much more horizontal than vertical to count. */
const DIRECTION_RATIO = 1.5

export interface StudyShortcutOptions {
  /** True while a card is on screen and can be answered. */
  active: boolean
  /** Whether the reference answer is visible. Grading needs it. */
  revealed: boolean
  /** True while a review is being written. */
  busy: boolean
  /** Reveal the reference answer. */
  onReveal: () => void
  /** Record a grade. */
  onGrade: (grade: ReviewGrade) => void
}

export interface StudyShortcutHandlers {
  /** Which grade a swipe would currently trigger, for the on-screen hint. */
  swipeHint: ReviewGrade | null
  touch: {
    onTouchStart: (event: React.TouchEvent) => void
    onTouchMove: (event: React.TouchEvent) => void
    onTouchEnd: (event: React.TouchEvent) => void
    onTouchCancel: () => void
  }
}

/**
 * Desktop keyboard shortcuts and phone swipe gestures for the study session.
 *
 * Keyboard:
 *   Space          reveal the answer
 *   1 / 2 / 3 / 4  Again / Hard / Good / Easy
 *
 * Touch (on the card area):
 *   swipe left     Again
 *   swipe right    Good
 *
 * Grading always requires the answer to be visible — the whole point of the
 * app is recalling *before* seeing it.
 */
export function useStudyShortcuts({
  active,
  revealed,
  busy,
  onReveal,
  onGrade,
}: StudyShortcutOptions): StudyShortcutHandlers {
  const [swipeHint, setSwipeHint] = useState<ReviewGrade | null>(null)

  /** Where the finger went down, in page coordinates. */
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!active) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // Leave browser and OS shortcuts alone.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // A held key must not fire a grade over and over.
      if (event.repeat) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      // Never steal keys while the user is typing an answer.
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }

      if (event.key === ' ' || event.code === 'Space') {
        // A focused button already handles Space on its own.
        if (tag === 'BUTTON') return
        event.preventDefault()
        if (!revealed && !busy) onReveal()
        return
      }

      const index = '1234'.indexOf(event.key)
      if (index >= 0) {
        event.preventDefault()
        if (!revealed || busy) return
        onGrade(GRADE_ORDER[index])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, revealed, busy, onReveal, onGrade])

  const onTouchStart = (event: React.TouchEvent) => {
    // The handwriting canvas lives inside the card panel — writing across it
    // must not be mistaken for a swipe.
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'CANVAS' || target.closest('canvas'))) {
      touchStart.current = null
      return
    }
    if (event.touches.length !== 1) {
      touchStart.current = null
      return
    }
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    setSwipeHint(null)
  }

  const onTouchMove = (event: React.TouchEvent) => {
    const start = touchStart.current
    if (!start || event.touches.length !== 1) return
    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y

    if (Math.abs(dx) < HINT_THRESHOLD || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) {
      setSwipeHint((current) => (current === null ? current : null))
      return
    }
    const grade: ReviewGrade = dx < 0 ? 'again' : 'good'
    setSwipeHint((current) => (current === grade ? current : grade))
  }

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    setSwipeHint(null)
    if (!start) return

    const touch = event.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return

    // The global handwriting overlay owns the touch surface while it is open.
    if (useInk.getState().enabled) return

    if (!revealed || busy) return
    onGrade(dx < 0 ? 'again' : 'good')
  }

  const onTouchCancel = () => {
    touchStart.current = null
    setSwipeHint(null)
  }

  return {
    swipeHint,
    touch: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  }
}
