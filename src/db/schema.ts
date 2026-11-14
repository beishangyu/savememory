/** Kind of raw material the user fed in. */
export type SourceKind = 'text' | 'image'

/** Question format. Stage 1 only generates `qa` and `cloze`; the rest are stage-3 ready. */
export type QuestionType = 'qa' | 'cloze' | 'choice' | 'truefalse' | 'feynman'

/** Author-declared difficulty of a *question* (independent from FSRS difficulty). */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** The four FSRS review grades. */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** How the user's answer was judged. */
export type AiVerdict = 'correct' | 'partial' | 'incorrect'

/** ts-fsrs card state: New / Learning / Review / Relearning. */
export type FsrsState = 0 | 1 | 2 | 3

/**
 * ts-fsrs `scheduleStatus`. Note that a card in the "Relearning" *state* still
 * reports `scheduleStatus: 'learning'`, so these three values are exhaustive.
 */
export type FsrsScheduleStatus = 'new' | 'learning' | 'review'

/** Why the user got it wrong. Stage 3 feature, stored now so history is complete. */
export type ErrorCause = 'forgotten' | 'confused' | 'not_understood'

export type GenerationStatus = 'pending' | 'done' | 'failed'

export type ProviderKind = 'openai' | 'gemini'

/** How the user's answer is turned into an FSRS grade. */
export type GradingMode = 'self' | 'ai'

/**
 * How cards are ordered inside one session.
 *
 * `interleave` mixes different topics so you never grind one concept to
 * death; `due` simply takes the most overdue card first.
 */
export type SessionOrder = 'interleave' | 'due'

/** A raw material (text note or, in stage 2, an image) that concepts are derived from. */
export interface Source {
  id: string
  kind: SourceKind
  title: string
  /** Extracted plain text. For images this is the OCR / vision output. */
  text: string
  /** The original image, stored as a Blob in IndexedDB. */
  image?: Blob
  imageMimeType?: string
  /**
   * True once `text` was produced by reading `image`. A retry then reuses the
   * extracted text instead of paying for vision again.
   */
  textExtractedFromImage?: boolean
  createdAt: number
  generationStatus: GenerationStatus
  generationError?: string
}

/** An atomic concept: exactly one independently testable fact / relation / definition. */
export interface Concept {
  id: string
  sourceId: string
  /** Position within the source, used to keep concept order stable. */
  index: number
  title: string
  /** The atomic statement itself. */
  statement: string
  elaboration?: string
  tags: string[]
  createdAt: number
}

/**
 * A reviewable card. Content fields describe the question; FSRS fields describe
 * the scheduling state of this card.
 */
export interface Card {
  id: string
  conceptId: string
  sourceId: string
  type: QuestionType
  /** The question stem. */
  prompt: string
  /** The reference answer, revealed only after the user has attempted recall. */
  answer: string
  /** For `choice` questions. */
  options?: string[]
  correctIndex?: number
  /** Author-declared difficulty of the question (used for the 30/50/20 split). */
  questionDifficulty: Difficulty

  // --- FSRS scheduling state (mirrors ts-fsrs card fields) ---
  fsrsStability: number
  fsrsStabilityFast: number
  fsrsDifficulty: number
  fsrsState: FsrsState
  fsrsScheduleStatus: FsrsScheduleStatus
  /** Epoch ms when this card next becomes due. */
  dueAt: number
  /** Epoch ms of the last review, null if never reviewed. */
  lastReviewAt: number | null
  reps: number
  lapses: number
  scheduledDays: number
  learningStep: number

  createdAt: number
}

/** One answered review. */
export interface ReviewLog {
  id: string
  cardId: string
  conceptId: string
  /** Numeric FSRS rating: 1=Again 2=Hard 3=Good 4=Easy. */
  rating: number
  reviewedAt: number
  /** Next due date produced by FSRS. */
  dueAt: number
  state: number
  elapsedDays: number
  scheduledDays: number
  durationMs: number
  mode: 'self' | 'ai'
  aiVerdict?: AiVerdict
  /** The AI's explanation for the grade it suggested. */
  aiFeedback?: string
  /** The rating the AI suggested, even if the user overrode it. */
  aiSuggestedRating?: number
  errorCause?: ErrorCause
}

/** A quick note the user jots down, independent of any study material. */
export interface Memo {
  id: string
  title: string
  content: string
  /** A hand-written version of the memo, stored as a PNG blob. */
  handwriting?: Blob
  createdAt: number
  updatedAt: number
  /** Pinned memos float to the top of the list. */
  pinned: boolean
  /** Set once the memo has been turned into study material. */
  sourceId?: string
  /** How many cards that conversion produced. */
  cardCount?: number
}

/** Application settings, stored locally. No account required. */
export interface Settings {
  id: 'settings'
  provider: ProviderKind
  baseUrl: string
  model: string
  /** Model used to read images. Empty means "reuse `model`". */
  visionModel: string
  apiKey: string
  /** FSRS target retention. */
  desiredRetention: number
  /** FSRS maximum interval in days. */
  maximumInterval: number
  /** How many questions to generate per concept. */
  questionsPerConcept: number
  /** Manual self-grading or AI grading of free-text answers. */
  gradingMode: GradingMode
  /** Which question formats the generator is allowed to use. */
  questionTypes: QuestionType[]
  /** How cards are ordered inside a session. */
  sessionOrder: SessionOrder
  /** Show a local notification / badge when cards become due. */
  remindersEnabled: boolean
  /** Default ink colour for handwriting. */
  inkColor: string
  /** How strongly pen pressure affects the line width (0..1). */
  inkPressure: number
  /**
   * Optional custom OCR endpoint, used when the vision model is unavailable.
   * Empty disables it; the manual "type the text yourself" fallback is used
   * instead.
   */
  ocrEndpoint: string
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  visionModel: '',
  apiKey: '',
  desiredRetention: 0.9,
  maximumInterval: 36500,
  questionsPerConcept: 2,
  gradingMode: 'self',
  questionTypes: ['qa', 'cloze', 'choice', 'truefalse'],
  sessionOrder: 'interleave',
  remindersEnabled: false,
  inkColor: '#e6e9ef',
  inkPressure: 1,
  ocrEndpoint: '',
}

/** Target difficulty mix for the first generation pass. */
export const DIFFICULTY_MIX: Record<Difficulty, number> = {
  easy: 0.3,
  medium: 0.5,
  hard: 0.2,
}
