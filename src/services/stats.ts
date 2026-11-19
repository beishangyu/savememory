import { cardsRepo, reviewLogsRepo } from '../db/repo'
import type { Settings } from '../db/schema'
import { forecastDailyLoad, type ForecastDay } from '../fsrs/scheduler'
import { startOfDay } from '../lib/date'

const MS_PER_DAY = 86_400_000

/** How many weeks the contribution graph covers. */
export const HEATMAP_WEEKS = 53

/** How many days the contribution graph covers. */
export const HEATMAP_DAYS = HEATMAP_WEEKS * 7

/** How many days the forecast looks ahead. */
export const FORECAST_DAYS = 7

/** One cell of the contribution graph. */
export interface HeatmapDay {
  /** Epoch ms of the local midnight the cell starts at. */
  dayStart: number
  /** How many reviews happened that day. */
  count: number
  /** 0 (empty) to 4 (busiest) — how dark the cell is drawn. */
  level: number
  /** True for days that have not happened yet. */
  future: boolean
}

export interface StatsOverview {
  /** Cards that still have to be reviewed today. */
  dueToday: number
  /** Reviews already logged today. */
  reviewedToday: number
  /** Every card in the library. */
  totalCards: number
  /** Every review ever logged. */
  totalReviews: number
}

export interface StatsBundle {
  heatmap: HeatmapDay[]
  overview: StatsOverview
  forecast: ForecastDay[]
}

/**
 * How dark a cell is drawn.
 *
 * Fixed thresholds rather than relative ones: a day with three reviews should
 * look the same today and in a year, and a lonely learner should still see
 * colour on the grid.
 */
export function heatLevel(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}

/**
 * Builds the contribution grid.
 *
 * The grid is laid out like GitHub's: one column per week (Sunday to
 * Saturday), 53 weeks ending with the current one.
 */
export function buildHeatmap(counts: Map<number, number>, now = Date.now()): HeatmapDay[] {
  const today = startOfDay(now)
  const weekday = new Date(today).getDay()
  // The grid ends on the Saturday of the current week.
  const gridEnd = today + (6 - weekday) * MS_PER_DAY
  const gridStart = gridEnd - (HEATMAP_DAYS - 1) * MS_PER_DAY

  const days: HeatmapDay[] = []
  for (let index = 0; index < HEATMAP_DAYS; index += 1) {
    const dayStart = gridStart + index * MS_PER_DAY
    const count = counts.get(dayStart) ?? 0
    days.push({
      dayStart,
      count,
      level: heatLevel(count),
      future: dayStart > today,
    })
  }
  return days
}

/**
 * Reads everything the statistics page needs from the local database.
 *
 * Nothing here talks to the network — the numbers come from `ReviewLog` and
 * `Card` rows in IndexedDB, and the forecast comes from the same FSRS
 * scheduler the study page uses.
 */
export async function loadStats(
  settings: Pick<Settings, 'desiredRetention' | 'maximumInterval'>,
  now = Date.now(),
): Promise<StatsBundle> {
  const today = startOfDay(now)
  const tomorrow = today + MS_PER_DAY

  // The grid reaches back a full year, so that is all the history we need.
  const gridStart = today - (HEATMAP_DAYS - 1) * MS_PER_DAY
  const logs = await reviewLogsRepo.listSince(gridStart)

  const counts = new Map<number, number>()
  for (const log of logs) {
    const day = startOfDay(log.reviewedAt)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  const [totalCards, totalReviews, reviewedToday, dueToday] = await Promise.all([
    cardsRepo.count(),
    reviewLogsRepo.count(),
    // Reviews logged between midnight and the end of today.
    reviewLogsRepo.countBetween(today, tomorrow - 1),
    // Cards due before tomorrow still have to be dealt with today.
    cardsRepo.countDueUntil(tomorrow - 1),
  ])

  // Only cards that come due inside the forecast window can matter.
  const windowEnd = today + FORECAST_DAYS * MS_PER_DAY - 1
  const cards = await cardsRepo.listDueUntil(windowEnd)
  const forecast = await forecastDailyLoad(
    {
      desiredRetention: settings.desiredRetention,
      maximumInterval: settings.maximumInterval,
    },
    cards,
    FORECAST_DAYS,
    new Date(now),
  )

  return {
    heatmap: buildHeatmap(counts, now),
    overview: { dueToday, reviewedToday, totalCards, totalReviews },
    forecast,
  }
}
