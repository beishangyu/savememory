import { z } from 'zod'

/**
 * Every piece of AI-generated content is validated against these schemas
 * *before* it is written to the database or fed into the scheduler. Nothing
 * reaches storage unvalidated.
 */

export const DifficultySchema = z.enum(['easy', 'medium', 'hard'])
export type DifficultyOutput = z.infer<typeof DifficultySchema>

export const QuestionTypeSchema = z.enum(['qa', 'cloze', 'choice', 'truefalse', 'feynman'])
export type QuestionTypeOutput = z.infer<typeof QuestionTypeSchema>

export const ConceptSchema = z.object({
  title: z.string().trim().min(1).max(40),
  statement: z.string().trim().min(1).max(300),
  elaboration: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().max(12)).max(5).optional(),
})
export type ConceptOutput = z.infer<typeof ConceptSchema>

export const ConceptListSchema = z.object({
  concepts: z.array(ConceptSchema).min(1),
})

export const QuestionSchema = z.object({
  conceptIndex: z.number().int().min(0),
  slotIndex: z.number().int().min(0).optional(),
  type: QuestionTypeSchema,
  prompt: z.string().trim().min(1).max(120),
  answer: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  correctIndex: z.number().int().min(0).max(5).optional(),
  difficulty: DifficultySchema,
})
export type QuestionOutput = z.infer<typeof QuestionSchema>

export const QuestionListSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
})

export const DifficultyLabelSchema = z.object({
  index: z.number().int().min(0),
  difficulty: DifficultySchema,
})
export type DifficultyLabelOutput = z.infer<typeof DifficultyLabelSchema>

export const DifficultyListSchema = z.object({
  labels: z.array(DifficultyLabelSchema),
})

/* ------------------------------------------------------------------ *
 * Stage 2: image understanding
 * ------------------------------------------------------------------ */

export const ImageExtractionSchema = z
  .object({
    /** All text visible in the image, in reading order. */
    text: z.string().trim().max(20000).default(''),
    /** A short inferred title. */
    title: z.string().trim().max(60).optional(),
    /** Primary language, e.g. "zh" or "en". */
    language: z.string().trim().max(20).optional(),
    /** Whether the image contains formulas or mathematical notation. */
    hasFormula: z.boolean().optional(),
    /** What the image is about — essential for photos and diagrams with little text. */
    semanticSummary: z.string().trim().max(1000).default(''),
  })
  .superRefine((value, ctx) => {
    if (!value.text && !value.semanticSummary) {
      ctx.addIssue({
        code: 'custom',
        message: 'text 与 semanticSummary 至少要有一个非空',
      })
    }
  })
export type ImageExtractionOutput = z.infer<typeof ImageExtractionSchema>

/* ------------------------------------------------------------------ *
 * Stage 2: free-text answer judgement
 * ------------------------------------------------------------------ */

export const VerdictSchema = z.enum(['correct', 'partial', 'incorrect'])
export type VerdictOutput = z.infer<typeof VerdictSchema>

/**
 * Which FSRS ratings are compatible with each verdict.
 *
 * The judgement directly drives the scheduler, so an inconsistent pair is
 * treated as invalid output: the model is asked again with an explicit error
 * message instead of letting a nonsense rating reach FSRS.
 */
export const VERDICT_ALLOWED_RATINGS: Record<VerdictOutput, readonly number[]> = {
  correct: [3, 4],
  partial: [2, 3],
  incorrect: [1],
}

export const JudgementSchema = z
  .object({
    verdict: VerdictSchema,
    /** Short explanation of why this grade was given. */
    feedback: z.string().trim().min(1).max(300),
    /** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. */
    suggestedRating: z.number().int().min(1).max(4),
  })
  .superRefine((value, ctx) => {
    const allowed = VERDICT_ALLOWED_RATINGS[value.verdict]
    if (!allowed.includes(value.suggestedRating)) {
      ctx.addIssue({
        code: 'custom',
        path: ['suggestedRating'],
        message: `verdict=${value.verdict} 时 suggestedRating 只能是 ${allowed.join(' 或 ')}`,
      })
    }
  })
export type JudgementOutput = z.infer<typeof JudgementSchema>
