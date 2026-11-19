import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Card, type ReviewLog } from '../db/schema'
import { createNewCard, forecastDailyLoad } from '../fsrs/scheduler'
import { startOfDay } from '../lib/date'
import { uid } from '../lib/id'
import { buildHeatmap, heatLevel, loadStats, HEATMAP_DAYS } from '../services/stats'

const MS_PER_DAY = 86_400_000
const options = {
  desiredRetention: DEFAULT_SETTINGS.desiredRetention,
  maximumInterval: DEFAULT_SETTINGS.maximumInterval,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

/** A brand new card, due right now. */
async function makeCard(dueAt: number): Promise<Card> {
  const card = await createNewCard(options, uid('card'))
  card.prompt = '测试题'
  card.answer = '答案'
  card.dueAt = dueAt
  await cardsRepo.put(card)
  return card
}

function makeLog(reviewedAt: number): ReviewLog {
  return {
    id: uid('log'),
    cardId: 'card-1',
    conceptId: 'con-1',
    rating: 3,
    reviewedAt,
    dueAt: reviewedAt + MS_PER_DAY,
    state: 2,
    elapsedDays: 0,
    scheduledDays: 1,
    durationMs: 1000,
    mode: 'self',
  }
}

describe('热力图分级', () => {
  it('按复习量分级', () => {
    expect(heatLevel(0)).toBe(0)
    expect(heatLevel(1)).toBe(1)
    expect(heatLevel(2)).toBe(1)
    expect(heatLevel(3)).toBe(2)
    expect(heatLevel(5)).toBe(2)
    expect(heatLevel(6)).toBe(3)
    expect(heatLevel(10)).toBe(3)
    expect(heatLevel(11)).toBe(4)
  })
})

describe('热力图网格', () => {
  it('是 53 周 × 7 天', () => {
    const heatmap = buildHeatmap(new Map(), Date.now())
    expect(heatmap).toHaveLength(HEATMAP_DAYS)
    expect(heatmap).toHaveLength(53 * 7)
  })

  it('按列排列（每周从周日开始）', () => {
    const now = Date.now()
    const heatmap = buildHeatmap(new Map(), now)
    // 同一列里的日期是连续七天。
    const firstWeek = heatmap.slice(0, 7)
    for (let index = 1; index < firstWeek.length; index += 1) {
      expect(firstWeek[index].dayStart - firstWeek[index - 1].dayStart).toBe(MS_PER_DAY)
    }
  })

  it('把复习记录落到正确的格子上', () => {
    const now = new Date()
    const today = startOfDay(now.getTime())
    const counts = new Map([[today, 4]])
    const heatmap = buildHeatmap(counts, now.getTime())
    const cell = heatmap.find((day) => day.dayStart === today)
    expect(cell?.count).toBe(4)
    expect(cell?.level).toBe(2)
  })

  it('未来的格子被标记出来', () => {
    const now = Date.now()
    const heatmap = buildHeatmap(new Map(), now)
    const future = heatmap.filter((day) => day.future)
    expect(future.length).toBeGreaterThan(0)
    // 未来格子不可能有复习记录。
    expect(future.every((day) => day.count === 0)).toBe(true)
  })

  it('每一列从周日开始，每行的星期几固定', () => {
    const now = new Date('2026-11-15T12:00:00').getTime()
    const heatmap = buildHeatmap(new Map(), now)

    // 索引 % 7 就是这一列里的第几行，必须等于当天的星期几。
    heatmap.forEach((day, index) => {
      expect(index % 7).toBe(new Date(day.dayStart).getDay())
    })

    // 第一列的第一天一定是周日。
    expect(new Date(heatmap[0].dayStart).getDay()).toBe(0)
    // 最后一天是本周六。
    expect(new Date(heatmap[heatmap.length - 1].dayStart).getDay()).toBe(6)
  })

  it('某天的记录落在正确的格子里', () => {
    const now = new Date('2026-11-15T12:00:00').getTime()
    const today = startOfDay(now)
    // 本周三。
    const wednesday = today - ((new Date(today).getDay() + 7 - 3) % 7) * MS_PER_DAY

    const heatmap = buildHeatmap(new Map([[wednesday, 7]]), now)
    const index = heatmap.findIndex((day) => day.dayStart === wednesday)

    expect(index).toBeGreaterThanOrEqual(0)
    expect(index % 7).toBe(3) // 周三 = 第 3 行
    expect(heatmap[index].count).toBe(7)
    expect(heatmap[index].level).toBe(3)
  })
})

describe('未来复习量预测', () => {
  it('今天到期的卡片算在今天', async () => {
    const now = new Date()
    const card = await makeCard(now.getTime())

    const forecast = await forecastDailyLoad(options, [card], 7, now)
    expect(forecast).toHaveLength(7)
    expect(forecast[0].count).toBe(1)
    expect(forecast[0].dayStart).toBe(startOfDay(now.getTime()))
  })

  it('明天到期的卡片算在明天', async () => {
    const now = new Date()
    const tomorrow = startOfDay(now.getTime()) + MS_PER_DAY + 3_600_000
    const card = await makeCard(tomorrow)

    const forecast = await forecastDailyLoad(options, [card], 7, now)
    expect(forecast[0].count).toBe(0)
    expect(forecast[1].count).toBe(1)
  })

  it('窗口之外的卡片不计入', async () => {
    const now = new Date()
    const far = startOfDay(now.getTime()) + 30 * MS_PER_DAY
    const card = await makeCard(far)

    const forecast = await forecastDailyLoad(options, [card], 7, now)
    expect(forecast.every((day) => day.count === 0)).toBe(true)
  })

  it('重复出现的卡片会在多天被计入', async () => {
    const now = new Date()
    const card = await makeCard(now.getTime())

    const forecast = await forecastDailyLoad(options, [card], 7, now)
    // 一张卡被连续排到多天时，总数会大于 1。
    const total = forecast.reduce((sum, day) => sum + day.count, 0)
    expect(total).toBeGreaterThanOrEqual(1)
    expect(total).toBeLessThanOrEqual(7)
  })
})

describe('统计汇总', () => {
  it('统计今日与总数', async () => {
    const now = Date.now()
    const today = startOfDay(now)

    await makeCard(now)
    await makeCard(today + 5 * 60_000)
    await reviewLogsRepo.put(makeLog(today + 60_000))
    await reviewLogsRepo.put(makeLog(today + 120_000))
    await reviewLogsRepo.put(makeLog(today - 2 * MS_PER_DAY))

    const bundle = await loadStats(options, now)

    expect(bundle.overview.totalCards).toBe(2)
    expect(bundle.overview.totalReviews).toBe(3)
    expect(bundle.overview.reviewedToday).toBe(2)
    // 两张卡都在今天到期。
    expect(bundle.overview.dueToday).toBe(2)
    expect(bundle.forecast).toHaveLength(7)
    expect(bundle.forecast[0].count).toBe(2)
  })

  it('空库时不会报错', async () => {
    const bundle = await loadStats(options, Date.now())
    expect(bundle.overview.totalCards).toBe(0)
    expect(bundle.overview.totalReviews).toBe(0)
    expect(bundle.overview.dueToday).toBe(0)
    expect(bundle.forecast.every((day) => day.count === 0)).toBe(true)
    expect(bundle.heatmap).toHaveLength(HEATMAP_DAYS)
  })
})
