import { db } from '../db/db'
import { cardsRepo, conceptsRepo, sourcesRepo } from '../db/repo'
import type { Card, Concept, Settings, Source } from '../db/schema'
import { createNewCard } from '../fsrs/scheduler'
import { providerFromSettings, visionProviderFromSettings } from '../llm'
import { extractConcepts, generateQuestions } from '../llm/generate'
import { extractionToMaterial, extractImageText } from '../llm/vision'
import type { LLMProvider } from '../llm/types'
import { LLMError } from '../llm/types'
import { uid } from '../lib/id'
import { resolveImagePayload } from '../llm/types'

export interface IngestResult {
  source: Source
  concepts: Concept[]
  cards: Card[]
}

/**
 * Raised when the image could not be read at all (model cannot see images,
 * network failure, unusable model output). The UI reacts by showing the
 * original picture and asking the user to type the content instead.
 */
export class ImageReadError extends Error {
  readonly cause: unknown
  /** The source whose image could not be read. */
  readonly sourceId: string

  constructor(sourceId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(message)
    this.name = 'ImageReadError'
    this.cause = cause
    this.sourceId = sourceId
  }
}

/** Create a text source. The source is stored immediately, before any AI call. */
export async function createTextSource(text: string, title: string): Promise<Source> {
  const source: Source = {
    id: uid('src'),
    kind: 'text',
    title: title.trim() || text.trim().slice(0, 30) || '未命名材料',
    text: text.trim(),
    createdAt: Date.now(),
    generationStatus: 'pending',
  }
  await sourcesRepo.put(source)
  return source
}

/** Create an image source. The image Blob is stored locally right away. */
export async function createImageSource(
  image: Blob,
  title: string,
  mimeType?: string,
): Promise<Source> {
  const source: Source = {
    id: uid('src'),
    kind: 'image',
    title: title.trim() || '图片材料',
    text: '',
    image,
    imageMimeType: mimeType ?? image.type,
    textExtractedFromImage: false,
    createdAt: Date.now(),
    generationStatus: 'pending',
  }
  await sourcesRepo.put(source)
  return source
}

/**
 * Read the text out of an image source using the vision model.
 *
 * Returns the material that feeds the regular concept/question pipeline.
 */
async function readImageSource(
  source: Source,
  settings: Settings,
  providerOverride?: LLMProvider,
): Promise<string> {
  if (!source.image) {
    throw new Error('该材料没有关联的图片')
  }

  const visionProvider = providerOverride ?? visionProviderFromSettings(settings)
  const payload = await resolveImagePayload({
    role: 'user',
    text: '',
    image: source.image,
    imageMimeType: source.imageMimeType,
  })

  if (!payload) {
    throw new Error('无法读取图片内容')
  }

  const extraction = await extractImageText(
    visionProvider,
    { base64: payload.base64, mimeType: payload.mimeType },
    { titleHint: source.title },
  )

  return extractionToMaterial(extraction)
}

/**
 * Optional custom OCR endpoint, used when the vision model is unavailable.
 *
 * Contract: POST `{"image":"data:image/png;base64,…"}` and expect either
 * `{"text":"…"}` or a plain-text body.
 */
async function ocrViaEndpoint(source: Source, settings: Settings): Promise<string | null> {
  const endpoint = settings.ocrEndpoint.trim()
  if (!endpoint || !source.image) return null

  try {
    const payload = await resolveImagePayload({
      role: 'user',
      text: '',
      image: source.image,
      imageMimeType: source.imageMimeType,
    })
    if (!payload) return null

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: `data:${payload.mimeType};base64,${payload.base64}`,
        mimeType: payload.mimeType,
      }),
    })
    if (!response.ok) return null

    const raw = (await response.text()).trim()
    if (!raw) return null

    try {
      const data = JSON.parse(raw) as { text?: unknown }
      return typeof data?.text === 'string' && data.text.trim() ? data.text.trim() : null
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

/**
 * Run the full pipeline for a source: material -> concepts -> questions -> cards.
 *
 * Every AI output is schema-validated before it is persisted. On failure the
 * source is marked as `failed` (keeping the material) so the user can retry
 * without re-uploading their notes.
 */
export async function generateForSource(
  sourceId: string,
  settings: Settings,
  /** Optional provider override, mainly for tests. */
  providerOverride?: LLMProvider,
): Promise<IngestResult> {
  let source = await sourcesRepo.get(sourceId)
  if (!source) throw new Error('找不到对应的材料')

  try {
    const textProvider = providerOverride ?? providerFromSettings(settings)

    // An image source has no text yet: read it first, then reuse the very same
    // concept/question pipeline as for pasted notes.
    let material = source.text
    if (source.kind === 'image' && !material.trim()) {
      try {
        material = await readImageSource(source, settings, providerOverride)
      } catch (err) {
        // Try the optional custom OCR endpoint before giving up on the image.
        const ocrText = await ocrViaEndpoint(source, settings)
        if (ocrText) {
          material = ocrText
        } else {
          throw new ImageReadError(sourceId, err)
        }
      }

      source = {
        ...source,
        text: material,
        textExtractedFromImage: true,
      }
      await sourcesRepo.put(source)
    }

    const rawConcepts = await extractConcepts(textProvider, material)

    const concepts: Concept[] = rawConcepts.map((raw, index) => ({
      id: uid('con'),
      sourceId,
      index,
      title: raw.title,
      statement: raw.statement,
      elaboration: raw.elaboration,
      tags: raw.tags ?? [],
      createdAt: Date.now(),
    }))

    const questions = await generateQuestions(textProvider, rawConcepts, {
      questionsPerConcept: settings.questionsPerConcept,
    })

    const cards: Card[] = []
    for (const question of questions) {
      const concept = concepts[question.conceptIndex]
      if (!concept) continue

      const cardId = uid('card')
      const card = await createNewCard(
        { desiredRetention: settings.desiredRetention, maximumInterval: settings.maximumInterval },
        cardId,
      )
      card.conceptId = concept.id
      card.sourceId = sourceId
      card.type = question.type
      card.prompt = question.prompt
      card.answer = question.answer
      card.options = question.options
      card.correctIndex = question.correctIndex
      card.questionDifficulty = question.difficulty
      cards.push(card)
    }

    if (cards.length === 0) {
      throw new Error('没有生成任何可复习的卡片')
    }

    // Write concepts and cards atomically so a half-finished generation can
    // never leave orphaned concepts behind.
    await db.transaction('rw', db.concepts, db.cards, async () => {
      await conceptsRepo.bulkPut(concepts)
      await cardsRepo.bulkPut(cards)
    })

    const updated: Source = { ...source, generationStatus: 'done', generationError: undefined }
    await sourcesRepo.put(updated)

    return { source: updated, concepts, cards }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await sourcesRepo.put({
      ...source,
      generationStatus: 'failed',
      generationError: message.slice(0, 500),
    })
    throw err
  }
}

/**
 * Continue an image source with text the user typed in themselves.
 *
 * This is the fallback when the configured model cannot read images: the user
 * looks at the picture and enters its content, and the normal
 * "text -> concept -> card" pipeline takes over from there.
 */
export async function continueWithManualText(
  sourceId: string,
  text: string,
  settings: Settings,
  providerOverride?: LLMProvider,
): Promise<IngestResult> {
  const source = await sourcesRepo.get(sourceId)
  if (!source) throw new Error('找不到对应的材料')

  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('请先输入图片中的文字内容')
  }

  await sourcesRepo.put({ ...source, text: trimmed, textExtractedFromImage: true })
  return generateForSource(sourceId, settings, providerOverride)
}

/**
 * True when the failure was caused by the model being unable to read images,
 * which means the manual fallback should be offered.
 */
export function isVisionFailure(err: unknown): boolean {
  return err instanceof LLMError && err.visionUnsupported === true
}
