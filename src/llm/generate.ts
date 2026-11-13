import type { Difficulty, QuestionType } from '../db/schema'
import { DIFFICULTY_MIX } from '../db/schema'
import { callJson } from './call'
import { balancePrompt, CONCEPT_PROMPT, questionPrompt, SYSTEM_PROMPT } from './prompts'
import {
  ConceptListSchema,
  DifficultyListSchema,
  QuestionListSchema,
  type ConceptOutput,
  type QuestionOutput,
} from './schemas'
import type { LLMProvider } from './types'

const MAX_CHUNK_CHARS = 6000
const CONCEPTS_PER_CHUNK = 4

export interface GeneratedQuestion {
  conceptIndex: number
  slotIndex: number
  type: QuestionType
  prompt: string
  answer: string
  options?: string[]
  correctIndex?: number
  difficulty: Difficulty
}

export interface GenerationOptions {
  questionsPerConcept: number
  temperature?: number
}

/** Split long material into overlapping-free chunks on paragraph boundaries. */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]

  const paragraphs = trimmed.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    if (paragraph.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars))
      }
      continue
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) chunks.push(current)
  return chunks.filter((c) => c.trim().length > 0)
}

/** Step 1: split the material into atomic concepts. */
export async function extractConcepts(
  provider: LLMProvider,
  text: string,
  options: { temperature?: number } = {},
): Promise<ConceptOutput[]> {
  const chunks = chunkText(text)
  const collected: ConceptOutput[] = []

  for (const chunk of chunks) {
    const result = await callJson(
      provider,
      [
        { role: 'system', text: SYSTEM_PROMPT },
        { role: 'user', text: `${CONCEPT_PROMPT}\n\n材料：\n"""\n${chunk}\n"""` },
      ],
      ConceptListSchema,
      { temperature: options.temperature ?? 0.3 },
    )
    collected.push(...result.concepts)
  }

  // Deduplicate by normalised title, keeping the first occurrence.
  const seen = new Set<string>()
  const unique: ConceptOutput[] = []
  for (const concept of collected) {
    const key = concept.title.replace(/\s+/g, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(concept)
  }

  if (unique.length === 0) {
    throw new Error('未能从材料中提取出任何原子概念')
  }
  return unique
}

/**
 * Build the per-question difficulty plan.
 *
 * The first generation pass must follow a 30% / 50% / 20% split, so we decide
 * the difficulty of every slot up front (guaranteeing the exact ratio) and ask
 * the model to write questions that match.
 */
export function buildDifficultyPlan(
  conceptCount: number,
  questionsPerConcept: number,
): Difficulty[][] {
  const total = Math.max(1, conceptCount * questionsPerConcept)
  const easy = Math.round(total * DIFFICULTY_MIX.easy)
  const medium = Math.round(total * DIFFICULTY_MIX.medium)
  const hard = total - easy - medium

  const pool: Difficulty[] = [
    ...Array<Difficulty>(easy).fill('easy'),
    ...Array<Difficulty>(medium).fill('medium'),
    ...Array<Difficulty>(hard).fill('hard'),
  ]
  // Fisher-Yates shuffle so concepts are not sorted by difficulty.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  // Deal round-robin so each concept gets a spread of difficulties.
  const assigned: Difficulty[][] = Array.from({ length: conceptCount }, () => [])
  let cursor = 0
  for (let slot = 0; slot < questionsPerConcept; slot += 1) {
    for (let concept = 0; concept < conceptCount; concept += 1) {
      assigned[concept].push(pool[cursor])
      cursor += 1
    }
  }
  return assigned
}

/** Normalise a raw question so it always satisfies our own invariants. */
function normaliseQuestion(raw: QuestionOutput): GeneratedQuestion {
  let type = raw.type as QuestionType
  let options = raw.options
  let correctIndex = raw.correctIndex

  if (type === 'cloze' && !raw.prompt.includes('{{')) {
    // The model forgot the blank markers — fall back to a plain question.
    type = 'qa'
  }
  if (type === 'choice') {
    const valid =
      Array.isArray(options) &&
      options.length >= 2 &&
      typeof correctIndex === 'number' &&
      correctIndex >= 0 &&
      correctIndex < options.length
    if (!valid) {
      type = 'qa'
      options = undefined
      correctIndex = undefined
    }
  }

  return {
    conceptIndex: raw.conceptIndex,
    slotIndex: raw.slotIndex ?? 0,
    type,
    prompt: raw.prompt.trim(),
    answer: raw.answer.trim(),
    options,
    correctIndex,
    difficulty: raw.difficulty,
  }
}

interface Slot {
  conceptIndex: number
  slotIndex: number
  target: Difficulty
  question?: GeneratedQuestion
}

/** Step 2: generate one extraction exercise per (concept, slot). */
export async function generateQuestions(
  provider: LLMProvider,
  concepts: ConceptOutput[],
  options: GenerationOptions,
): Promise<GeneratedQuestion[]> {
  const plan = buildDifficultyPlan(concepts.length, options.questionsPerConcept)

  const slots: Slot[] = []
  for (let conceptIndex = 0; conceptIndex < concepts.length; conceptIndex += 1) {
    const difficulties = plan[conceptIndex]
    for (let slotIndex = 0; slotIndex < difficulties.length; slotIndex += 1) {
      slots.push({
        conceptIndex,
        slotIndex,
        target: difficulties[slotIndex],
      })
    }
  }

  // Generate in chunks so no single request gets too large.
  for (let start = 0; start < concepts.length; start += CONCEPTS_PER_CHUNK) {
    const chunkConcepts = concepts.slice(start, start + CONCEPTS_PER_CHUNK)
    const chunkSlots = slots.filter(
      (slot) => slot.conceptIndex >= start && slot.conceptIndex < start + chunkConcepts.length,
    )

    const planItems = chunkConcepts.map((concept, offset) => ({
      index: start + offset,
      title: concept.title,
      statement: concept.statement,
      slots: chunkSlots
        .filter((slot) => slot.conceptIndex === start + offset)
        .map((slot) => slot.target),
    }))

    const result = await callJson(
      provider,
      [
        { role: 'system', text: SYSTEM_PROMPT },
        { role: 'user', text: questionPrompt(planItems) },
      ],
      QuestionListSchema,
      { temperature: options.temperature ?? 0.7 },
    )

    for (const raw of result.questions) {
      const question = normaliseQuestion(raw)
      // The model may echo a concept index from a previous chunk; ignore those.
      if (question.conceptIndex < start || question.conceptIndex >= start + chunkConcepts.length) {
        continue
      }
      const slot = chunkSlots.find(
        (candidate) =>
          candidate.conceptIndex === question.conceptIndex &&
          candidate.slotIndex === question.slotIndex,
      )
      if (!slot || slot.question) continue
      slot.question = question
    }
  }

  const filled = slots.filter((slot): slot is Slot & { question: GeneratedQuestion } => !!slot.question)

  if (filled.length === 0) {
    throw new Error('模型没有生成任何有效题目')
  }

  await balanceDifficulties(provider, filled)

  return filled.map((slot) => ({ ...slot.question, difficulty: slot.question.difficulty }))
}

/**
 * Step 3: enforce the 30/50/20 difficulty mix.
 *
 * If the model's own labels do not match the target counts we ask it to
 * re-label the questions (without touching the content). If that call fails we
 * fall back to the pre-computed plan, which always hits the exact ratio.
 */
async function balanceDifficulties(
  provider: LLMProvider,
  slots: Array<Slot & { question: GeneratedQuestion }>,
): Promise<void> {
  const total = slots.length
  const targets: Record<Difficulty, number> = {
    easy: Math.round(total * DIFFICULTY_MIX.easy),
    medium: Math.round(total * DIFFICULTY_MIX.medium),
    hard: total - Math.round(total * DIFFICULTY_MIX.easy) - Math.round(total * DIFFICULTY_MIX.medium),
  }

  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 }
  for (const slot of slots) counts[slot.question.difficulty] += 1

  const alreadyBalanced =
    counts.easy === targets.easy &&
    counts.medium === targets.medium &&
    counts.hard === targets.hard
  if (alreadyBalanced) return

  try {
    const result = await callJson(
      provider,
      [
        { role: 'system', text: SYSTEM_PROMPT },
        {
          role: 'user',
          text: balancePrompt(
            slots.map((slot, index) => ({
              index,
              prompt: slot.question.prompt,
              difficulty: slot.question.difficulty,
            })),
            targets,
          ),
        },
      ],
      DifficultyListSchema,
      { temperature: 0 },
    )

    const labels = new Map(result.labels.map((label) => [label.index, label.difficulty]))
    slots.forEach((slot, index) => {
      const label = labels.get(index)
      if (label) slot.question.difficulty = label
    })
  } catch {
    // Degrade to the pre-computed plan — the ratio is still exactly correct.
    for (const slot of slots) {
      slot.question.difficulty = slot.target
    }
  }
}
