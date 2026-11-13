import { create } from 'zustand'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import type { Card, ReviewGrade, ReviewLog } from '../db/schema'
import { reviewCard } from '../fsrs/scheduler'
import { judgeAnswer, type Judgement } from '../llm/judge'
import { providerFromSettings } from '../llm'
import type { LLMProvider } from '../llm/types'
import { uid } from '../lib/id'
import { useSettings } from './settings'

/** A card may be re-queued at most this many times inside one session. */
const MAX_REQUEUES = 3

export interface SessionResult {
  cardId: string
  grade: ReviewGrade
  dueAt: number
}

interface StudyState {
  /** The queue of cards for the current session. */
  queue: Card[]
  /** Index of the card currently being answered. */
  index: number
  /** Whether the reference answer has been revealed for the current card. */
  revealed: boolean
  /** Free-text answer typed by the user (optional). */
  userAnswer: string
  busy: boolean
  error: string | null
  results: SessionResult[]
  /** Timestamp the current card was shown, used to measure answer duration. */
  shownAt: number
  /** How many times each card has been re-queued this session. */
  requeues: Record<string, number>

  /** True while the AI is grading the user's answer. */
  judging: boolean
  /** The AI's judgement for the current card, if any. */
  judgement: Judgement | null
  /** The grade the AI suggests; highlighted in the UI but overridable. */
  suggestedGrade: ReviewGrade | null
  /** Why AI grading failed, if it did. */
  judgeError: string | null

  start: (cards: Card[]) => void
  setUserAnswer: (text: string) => void
  reveal: () => void
  /** Ask the AI to grade the typed answer. Falls back to manual grading. */
  judge: (providerOverride?: LLMProvider) => Promise<void>
  submit: (grade: ReviewGrade) => Promise<void>
  reset: () => void
}

export const useStudy = create<StudyState>((set, get) => ({
  queue: [],
  index: 0,
  revealed: false,
  userAnswer: '',
  busy: false,
  error: null,
  results: [],
  shownAt: 0,
  requeues: {},
  judging: false,
  judgement: null,
  suggestedGrade: null,
  judgeError: null,

  start: (cards) =>
    set({
      queue: cards,
      index: 0,
      revealed: false,
      userAnswer: '',
      busy: false,
      error: null,
      results: [],
      shownAt: Date.now(),
      requeues: {},
      judging: false,
      judgement: null,
      suggestedGrade: null,
      judgeError: null,
    }),

  setUserAnswer: (text) => set({ userAnswer: text }),

  reveal: () => set({ revealed: true }),

  reset: () =>
    set({
      queue: [],
      index: 0,
      revealed: false,
      userAnswer: '',
      busy: false,
      error: null,
      results: [],
      shownAt: 0,
      requeues: {},
      judging: false,
      judgement: null,
      suggestedGrade: null,
      judgeError: null,
    }),

  judge: async (providerOverride?: LLMProvider) => {
    const state = get()
    const card = state.queue[state.index]
    if (!card || state.judging || state.busy) return

    const answer = state.userAnswer.trim()
    if (!answer) {
      // Nothing to grade: show the reference answer and suggest "重来".
      set({
        revealed: true,
        judgement: null,
        suggestedGrade: 'again',
        judgeError: '你还没有作答，这张卡片将计为「重来」。',
      })
      return
    }

    set({ judging: true, judgeError: null })

    try {
      const settings = useSettings.getState().settings
      const provider = providerOverride ?? providerFromSettings(settings)

      const judgement = await judgeAnswer(provider, {
        prompt: card.prompt,
        reference: card.answer,
        userAnswer: answer,
      })

      set({
        judging: false,
        revealed: true,
        judgement,
        suggestedGrade: judgement.grade,
        judgeError: null,
      })
    } catch (err) {
      // Never let a failed judgement apply a rating. Fall back to manual grading.
      set({
        judging: false,
        revealed: true,
        judgement: null,
        suggestedGrade: null,
        judgeError: `AI 评判失败，已切换为手动评分：${
          err instanceof Error ? err.message : String(err)
        }`,
      })
    }
  },

  submit: async (grade) => {
    const state = get()
    const card = state.queue[state.index]
    if (!card || state.busy) return

    set({ busy: true, error: null })

    try {
      const settings = useSettings.getState().settings
      const now = new Date()
      const outcome = await reviewCard(
        { desiredRetention: settings.desiredRetention, maximumInterval: settings.maximumInterval },
        card,
        grade,
        now,
      )

      const log: ReviewLog = {
        id: uid('log'),
        cardId: card.id,
        conceptId: card.conceptId,
        rating: outcome.revlog.rating,
        reviewedAt: now.getTime(),
        dueAt: outcome.revlog.dueAt.getTime(),
        state: outcome.revlog.state,
        elapsedDays: outcome.revlog.elapsedDays,
        scheduledDays: outcome.revlog.scheduledDays,
        durationMs: Math.max(0, now.getTime() - state.shownAt),
        mode: state.judgement ? 'ai' : 'self',
        aiVerdict: state.judgement?.verdict,
        aiFeedback: state.judgement?.feedback,
        aiSuggestedRating: state.judgement?.suggestedRating,
      }

      await cardsRepo.put(outcome.card)
      await reviewLogsRepo.put(log)

      const queue = [...state.queue]
      const results = [
        ...state.results,
        { cardId: card.id, grade, dueAt: outcome.revlog.dueAt.getTime() },
      ]

      // A card answered with "重来" comes back at the end of the session so it
      // can be attempted again — but it still goes through the full
      // recall-then-reveal flow, nothing is skipped.
      const nextRequeues = { ...state.requeues }
      if (grade === 'again') {
        const seen = nextRequeues[card.id] ?? 0
        if (seen < MAX_REQUEUES) {
          queue.push(outcome.card)
          nextRequeues[card.id] = seen + 1
        }
      }

      set({
        queue,
        results,
        requeues: nextRequeues,
        index: state.index + 1,
        revealed: false,
        userAnswer: '',
        shownAt: Date.now(),
        busy: false,
        judging: false,
        judgement: null,
        suggestedGrade: null,
        judgeError: null,
      })
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}))

/** The card currently being answered, if any. */
export function selectCurrentCard(state: StudyState): Card | undefined {
  return state.queue[state.index]
}

/** Whether the session has run out of cards. */
export function selectSessionFinished(state: StudyState): boolean {
  return state.queue.length > 0 && state.index >= state.queue.length
}
