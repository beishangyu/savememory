import { DefaultScheduler } from 'ts-fsrs'
import type { Card, FsrsScheduleStatus, FsrsState, ReviewGrade } from '../db/schema'

export type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>

/** The numeric FSRS ratings. `Manual` (0) is intentionally not exposed. */
export const FSRS_RATING = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const

export type FsrsRating = (typeof FSRS_RATING)[keyof typeof FSRS_RATING]

/**
 * The card shape accepted by `scheduler.review()`.
 *
 * We declare this explicitly instead of using the library's
 * `DefaultSchedulerCardInput`, because that type (a) is a union that omits
 * `stabilityFast`, and (b) FSRS-7 *requires* `stabilityFast` at runtime —
 * passing a card without it throws
 * "Expected FSRS7 memory state with finite stability, stabilityFast and difficulty".
 * Declaring it here makes TypeScript protect us from that runtime trap.
 */
export type SchedulerCardInput = {
  stability: number
  stabilityFast: number
  difficulty: number
  state: FsrsState
  scheduleStatus: FsrsScheduleStatus
  dueAt: Date
  lastReviewAt: Date | null
  cardId: string | number
  reps: number
  lapses: number
  scheduledDays: number
  learningStep: number
}

/** The card shape returned by the scheduler. `stabilityFast` is present at runtime for FSRS-7. */
export type SchedulerCardOut = {
  stability: number
  stabilityFast?: number
  difficulty: number
  state: number
  scheduleStatus: string
  dueAt: Date
  lastReviewAt: Date | null
  reps: number
  lapses: number
  scheduledDays: number
  learningStep: number
}

export const GRADE_ORDER: ReviewGrade[] = ['again', 'hard', 'good', 'easy']

export const GRADE_LABEL: Record<ReviewGrade, string> = {
  again: '重来',
  hard: '困难',
  good: '良好',
  easy: '简单',
}

/** Rough meaning of each grade, shown next to the buttons. */
export const GRADE_HINT: Record<ReviewGrade, string> = {
  again: '完全想不起来',
  hard: '想起来了但很吃力',
  good: '想起来了',
  easy: '毫不费力',
}

const GRADE_TO_RATING: Record<ReviewGrade, FsrsRating> = {
  again: FSRS_RATING.Again,
  hard: FSRS_RATING.Hard,
  good: FSRS_RATING.Good,
  easy: FSRS_RATING.Easy,
}

export function gradeToRating(grade: ReviewGrade): FsrsRating {
  return GRADE_TO_RATING[grade]
}

export function ratingToGrade(rating: number): ReviewGrade {
  switch (rating) {
    case FSRS_RATING.Again:
      return 'again'
    case FSRS_RATING.Hard:
      return 'hard'
    case FSRS_RATING.Easy:
      return 'easy'
    default:
      return 'good'
  }
}

let cached: { key: string; scheduler: Scheduler } | null = null

/**
 * The scheduler is stateless with respect to a card, so a single instance can be
 * reused. It is rebuilt only when the scheduling configuration changes.
 */
export async function getScheduler(options: {
  desiredRetention: number
  maximumInterval: number
}): Promise<Scheduler> {
  const key = `${options.desiredRetention}:${options.maximumInterval}`
  if (!cached || cached.key !== key) {
    const scheduler = await DefaultScheduler({
      desiredRetention: options.desiredRetention,
      maximumInterval: options.maximumInterval,
      enableFuzz: false,
    })
    cached = { key, scheduler }
  }
  return cached.scheduler
}

/** Reset the memoised scheduler (used after a settings change). */
export function resetScheduler(): void {
  cached = null
}

/**
 * Rebuild a ts-fsrs card from a persisted row.
 *
 * IMPORTANT: ts-fsrs stores `Date` instances on the card. IndexedDB returns
 * plain strings, and passing those back to `review()` throws
 * "Expected valid Date fields". Every card read from the database must go
 * through this function.
 */
export function toSchedulerCard(card: Card): SchedulerCardInput {
  return {
    stability: card.fsrsStability,
    stabilityFast: card.fsrsStabilityFast,
    difficulty: card.fsrsDifficulty,
    state: card.fsrsState,
    scheduleStatus: card.fsrsScheduleStatus,
    dueAt: new Date(card.dueAt),
    lastReviewAt: card.lastReviewAt === null ? null : new Date(card.lastReviewAt),
    cardId: card.id,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduledDays,
    learningStep: card.learningStep,
  }
}

/** Copy the FSRS state of a scheduler card back onto our own row shape. */
export function applySchedulerCard(target: Card, schedulerCard: SchedulerCardOut): Card {
  target.fsrsStability = schedulerCard.stability
  target.fsrsStabilityFast = schedulerCard.stabilityFast ?? target.fsrsStabilityFast
  target.fsrsDifficulty = schedulerCard.difficulty
  target.fsrsState = schedulerCard.state as FsrsState
  target.fsrsScheduleStatus = schedulerCard.scheduleStatus as FsrsScheduleStatus
  target.dueAt = schedulerCard.dueAt.getTime()
  target.lastReviewAt = schedulerCard.lastReviewAt ? schedulerCard.lastReviewAt.getTime() : null
  target.reps = schedulerCard.reps
  target.lapses = schedulerCard.lapses
  target.scheduledDays = schedulerCard.scheduledDays
  target.learningStep = schedulerCard.learningStep
  return target
}

/** Create a brand new (unreviewed) card scheduled by FSRS. */
export async function createNewCard(
  options: { desiredRetention: number; maximumInterval: number },
  cardId: string,
  now = new Date(),
): Promise<Card> {
  const scheduler = await getScheduler(options)
  const fresh: SchedulerCardOut = scheduler.newCard({ now, cardId })

  return {
    id: cardId,
    conceptId: '',
    sourceId: '',
    type: 'qa',
    prompt: '',
    answer: '',
    questionDifficulty: 'medium',
    fsrsStability: fresh.stability,
    fsrsStabilityFast: fresh.stabilityFast ?? 0,
    fsrsDifficulty: fresh.difficulty,
    fsrsState: fresh.state as FsrsState,
    fsrsScheduleStatus: fresh.scheduleStatus as FsrsScheduleStatus,
    dueAt: fresh.dueAt.getTime(),
    lastReviewAt: fresh.lastReviewAt ? fresh.lastReviewAt.getTime() : null,
    reps: fresh.reps,
    lapses: fresh.lapses,
    scheduledDays: fresh.scheduledDays,
    learningStep: fresh.learningStep,
    createdAt: now.getTime(),
  }
}

export interface ReviewOutcome {
  card: Card
  revlog: {
    rating: number
    state: number
    dueAt: Date
    reviewTime: Date
    scheduledDays: number
    elapsedDays: number
    stability: number
    stabilityFast: number
    difficulty: number
  }
}

const MS_PER_DAY = 86_400_000

/** Apply a grade to a card and return the updated card plus the review log. */
export async function reviewCard(
  options: { desiredRetention: number; maximumInterval: number },
  card: Card,
  grade: ReviewGrade,
  now = new Date(),
): Promise<ReviewOutcome> {
  const scheduler = await getScheduler(options)
  const result = scheduler.review({
    card: toSchedulerCard(card),
    grade: gradeToRating(grade),
    now,
  })

  const updated = applySchedulerCard({ ...card }, result.card)

  // ts-fsrs does not expose elapsedDays on the revlog; derive it ourselves so
  // the review history stays meaningful for the user.
  const elapsedDays = card.lastReviewAt
    ? Math.max(0, (now.getTime() - card.lastReviewAt) / MS_PER_DAY)
    : 0

  const revlog = result.revlog
  const revlogFast = (revlog as { stabilityFast?: number }).stabilityFast ?? 0
  return {
    card: updated,
    revlog: {
      rating: Number(revlog.rating),
      state: revlog.state,
      dueAt: new Date(revlog.dueAt),
      reviewTime: new Date(revlog.reviewTime),
      scheduledDays: revlog.scheduledDays,
      elapsedDays,
      stability: revlog.stability,
      stabilityFast: revlogFast,
      difficulty: revlog.difficulty,
    },
  }
}

/**
 * Preview what each of the four grades would schedule. Used to show the user
 * "下次复习" hints before they commit to a grade.
 */
export async function previewGrades(
  options: { desiredRetention: number; maximumInterval: number },
  card: Card,
  now = new Date(),
): Promise<Record<ReviewGrade, number>> {
  const scheduler = await getScheduler(options)
  const previews = scheduler.preview({ card: toSchedulerCard(card), now })

  const result = {} as Record<ReviewGrade, number>
  for (const item of previews) {
    result[ratingToGrade(item.grade)] = item.card.dueAt.getTime()
  }
  return result
}
