import type { ReviewGrade } from '../db/schema'
import { callJson } from './call'
import { JUDGE_PROMPT, SYSTEM_PROMPT } from './prompts'
import { JudgementSchema, type JudgementOutput } from './schemas'
import type { LLMProvider } from './types'

export interface Judgement extends JudgementOutput {
  /** The FSRS rating this judgement maps to. */
  grade: ReviewGrade
}

const RATING_TO_GRADE: Record<number, ReviewGrade> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
}

/**
 * Grade a free-text answer against the reference answer.
 *
 * The result is validated with Zod before it is returned, including a
 * consistency check between `verdict` and `suggestedRating`. A model that
 * returns an inconsistent pair is asked again with an explicit error message;
 * if it still fails, this throws and the caller degrades to manual grading —
 * an unvalidated rating never reaches FSRS.
 */
export async function judgeAnswer(
  provider: LLMProvider,
  input: {
    prompt: string
    reference: string
    userAnswer: string
    conceptStatement?: string
  },
): Promise<Judgement> {
  const body = [
    `题目：${input.prompt}`,
    input.conceptStatement ? `所属概念：${input.conceptStatement}` : '',
    `参考答案：${input.reference}`,
    `用户的作答：${input.userAnswer}`,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callJson(
    provider,
    [
      { role: 'system', text: SYSTEM_PROMPT },
      { role: 'user', text: `${JUDGE_PROMPT}\n\n${body}` },
    ],
    JudgementSchema,
    { temperature: 0, maxTokens: 500 },
  )

  return {
    ...result,
    grade: RATING_TO_GRADE[result.suggestedRating],
  }
}
