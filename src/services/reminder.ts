/**
 * Local reminders.
 *
 * The rule from the product spec: only say *that* something is due — never
 * push the content itself. Otherwise "glancing at a notification" would count
 * as a review and silently corrupt the schedule.
 */

export type ReminderPermission = 'default' | 'granted' | 'denied' | 'unsupported'

/**
 * The Badge API is only implemented on some platforms, so we probe for it at
 * runtime instead of trusting the type definitions.
 */
interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function getReminderPermission(): ReminderPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return 'denied'
  }
}

/**
 * Show the number of due cards on the app icon and in the page title.
 *
 * The icon badge is only available on some platforms; the title badge works
 * everywhere and is the reliable fallback.
 */
export function updateAppBadge(count: number): void {
  if (typeof document !== 'undefined') {
    document.title = count > 0 ? `(${count}) 记忆训练` : '记忆训练 · SaveMemory'
  }

  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as BadgeNavigator) : undefined
  if (!nav) return

  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      void nav.setAppBadge(count).catch(() => {})
    } else if (count === 0 && typeof nav.clearAppBadge === 'function') {
      void nav.clearAppBadge().catch(() => {})
    }
  } catch {
    // Badges are a nice-to-have; never let them break the app.
  }
}

/**
 * Show a notification telling the user that cards are due.
 *
 * The body deliberately contains no card content — only a count.
 */
export function showDueNotification(count: number): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (count <= 0) return

  try {
    const notification = new Notification('记忆训练', {
      body: `有 ${count} 张卡片到期了，打开应用开始复习。`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'savememory-due',
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Some browsers require a service worker for notifications; ignore.
  }
}

const MAX_TIMEOUT = 2 ** 31 - 1

/**
 * Schedule a notification for the moment the next card becomes due.
 *
 * Returns a function that cancels the timer.
 */
export function scheduleDueNotification(dueAt: number, count: number): () => void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return () => {}
  }

  const delay = Math.min(Math.max(0, dueAt - Date.now()), MAX_TIMEOUT)
  const timer = setTimeout(() => {
    showDueNotification(count)
  }, delay)

  return () => clearTimeout(timer)
}
