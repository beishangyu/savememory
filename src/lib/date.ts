const dateTimeFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatDateTime(ts: number): string {
  return dateTimeFmt.format(new Date(ts))
}

export function formatDate(ts: number): string {
  return dateFmt.format(new Date(ts))
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (abs < minute) return '不到 1 分钟'
  if (abs < hour) return `${Math.round(abs / minute)} 分钟`
  if (abs < day) return `${Math.round(abs / hour)} 小时`
  const days = Math.round(abs / day)
  if (days < 30) return `${days} 天`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} 个月`
  return `${Math.round(months / 12)} 年`
}

/** Start of the local calendar day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}
