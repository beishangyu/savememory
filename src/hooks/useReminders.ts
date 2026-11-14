import { useEffect } from 'react'
import { cardsRepo } from '../db/repo'
import {
  scheduleDueNotification,
  updateAppBadge,
} from '../services/reminder'

/**
 * Keeps the app badge in sync and schedules a local notification for the
 * moment the next card becomes due.
 *
 * The notification only says *how many* cards are due — never their content,
 * so that glancing at it never counts as a review.
 */
export function useReminders(enabled: boolean, dueCount: number): void {
  // The badge is useful even without notification permission.
  useEffect(() => {
    updateAppBadge(dueCount)
  }, [dueCount])

  useEffect(() => {
    if (!enabled) return

    let cancel: (() => void) | undefined
    let cancelled = false

    void (async () => {
      const nextDueAt = await cardsRepo.nextDueAt()
      if (cancelled || nextDueAt === undefined) return

      const count = await cardsRepo.countDue(nextDueAt)
      if (cancelled) return

      cancel = scheduleDueNotification(nextDueAt, count)
    })()

    return () => {
      cancelled = true
      cancel?.()
    }
  }, [enabled])
}
