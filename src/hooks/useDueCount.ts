import { useEffect, useState } from 'react'
import { cardsRepo } from '../db/repo'

/** Poll the number of due cards so the nav badge stays accurate. */
export function useDueCount(intervalMs = 30_000): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const due = await cardsRepo.countDue(Date.now())
      if (!cancelled) setCount(due)
    }

    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [intervalMs])

  return count
}
