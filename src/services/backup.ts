import { z } from 'zod'
import { db } from '../db/db'
import { fromBase64, readAsDataUrl, splitDataUrl } from '../lib/image'

export const BACKUP_FORMAT = 'savememory-backup'
export const BACKUP_VERSION = 1

/* ------------------------------------------------------------------ *
 * Schema — the same discipline as for AI output: nothing is trusted
 * until it has been validated.
 * ------------------------------------------------------------------ */

const ImageDataSchema = z.object({
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
})

const SourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['text', 'image']),
  title: z.string(),
  text: z.string(),
  imageMimeType: z.string().optional(),
  textExtractedFromImage: z.boolean().optional(),
  createdAt: z.number(),
  generationStatus: z.enum(['pending', 'done', 'failed']),
  generationError: z.string().optional(),
  imageData: ImageDataSchema.nullable().optional(),
})

const ConceptSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  index: z.number(),
  title: z.string(),
  statement: z.string(),
  elaboration: z.string().optional(),
  tags: z.array(z.string()),
  createdAt: z.number(),
})

const CardSchema = z.object({
  id: z.string().min(1),
  conceptId: z.string(),
  sourceId: z.string(),
  type: z.enum(['qa', 'cloze', 'choice', 'truefalse', 'feynman']),
  prompt: z.string(),
  answer: z.string(),
  options: z.array(z.string()).optional(),
  correctIndex: z.number().optional(),
  questionDifficulty: z.enum(['easy', 'medium', 'hard']),
  fsrsStability: z.number(),
  fsrsStabilityFast: z.number(),
  fsrsDifficulty: z.number(),
  fsrsState: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  fsrsScheduleStatus: z.enum(['new', 'learning', 'review']),
  dueAt: z.number(),
  lastReviewAt: z.number().nullable(),
  reps: z.number(),
  lapses: z.number(),
  scheduledDays: z.number(),
  learningStep: z.number(),
  createdAt: z.number(),
})

const ReviewLogSchema = z.object({
  id: z.string().min(1),
  cardId: z.string(),
  conceptId: z.string(),
  rating: z.number(),
  reviewedAt: z.number(),
  dueAt: z.number(),
  state: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  durationMs: z.number(),
  mode: z.enum(['self', 'ai']),
  aiVerdict: z.enum(['correct', 'partial', 'incorrect']).optional(),
  aiFeedback: z.string().optional(),
  aiSuggestedRating: z.number().optional(),
  errorCause: z.enum(['forgotten', 'confused', 'not_understood']).optional(),
})

/** The API key is deliberately never part of a backup. */
const SettingsSchema = z.object({
  id: z.literal('settings'),
  provider: z.enum(['openai', 'gemini']),
  baseUrl: z.string(),
  model: z.string(),
  visionModel: z.string(),
  apiKey: z.string(),
  desiredRetention: z.number(),
  maximumInterval: z.number(),
  questionsPerConcept: z.number(),
  gradingMode: z.enum(['self', 'ai']),
  questionTypes: z.array(z.enum(['qa', 'cloze', 'choice', 'truefalse', 'feynman'])),
  sessionOrder: z.enum(['interleave', 'due']),
  remindersEnabled: z.boolean(),
  // Added after the first release; older backups simply do not have them.
  inkColor: z.string().default('#e6e9ef'),
  inkPressure: z.number().default(1),
  ocrEndpoint: z.string(),
})

const MemoSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  handwritingData: ImageDataSchema.nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean(),
  sourceId: z.string().optional(),
  cardCount: z.number().optional(),
})

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  exportedAt: z.number(),
  /** Always false — a reminder that the API key is not included. */
  apiKeyIncluded: z.literal(false),
  sources: z.array(SourceSchema),
  concepts: z.array(ConceptSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
  memos: z.array(MemoSchema).optional(),
  settings: SettingsSchema.optional(),
})

export type Backup = z.infer<typeof BackupSchema>

export interface BackupCounts {
  sources: number
  concepts: number
  cards: number
  reviewLogs: number
  memos: number
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * Collect every table into a JSON-serialisable structure.
 *
 * Images are stored as data URLs so the backup is complete — a material
 * without its picture would be half-restored. The API key is removed.
 */
export async function buildBackup(): Promise<Backup> {
  const [sources, concepts, cards, reviewLogs, settings, memos] = await Promise.all([
    db.sources.toArray(),
    db.concepts.toArray(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
    db.settings.get('settings'),
    db.memos.toArray(),
  ])

  const serializedSources = await Promise.all(
    sources.map(async (source) => {
      const { image, ...rest } = source
      let imageData: { mimeType: string; dataUrl: string } | null = null

      if (image && image.size > 0) {
        const dataUrl = await readAsDataUrl(image)
        imageData = {
          mimeType: source.imageMimeType ?? image.type ?? 'image/png',
          dataUrl,
        }
      }

      return { ...rest, imageData }
    }),
  )

  const serializedMemos = await Promise.all(
    memos.map(async (memo) => {
      const { handwriting, ...rest } = memo
      let handwritingData: { mimeType: string; dataUrl: string } | null = null

      if (handwriting && handwriting.size > 0) {
        handwritingData = {
          mimeType: handwriting.type || 'image/png',
          dataUrl: await readAsDataUrl(handwriting),
        }
      }

      return { ...rest, handwritingData }
    }),
  )

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    apiKeyIncluded: false,
    sources: serializedSources,
    concepts,
    cards,
    reviewLogs,
    memos: serializedMemos,
    settings: settings ? { ...settings, apiKey: '' } : undefined,
  }
}

/** Build the backup and hand it to the browser as a download. */
export async function downloadBackup(): Promise<BackupCounts> {
  const backup = await buildBackup()
  const json = JSON.stringify(backup, null, 2)

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const link = document.createElement('a')

  link.href = url
  link.download = `savememory-backup-${stamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)

  return {
    sources: backup.sources.length,
    concepts: backup.concepts.length,
    cards: backup.cards.length,
    reviewLogs: backup.reviewLogs.length,
    memos: backup.memos?.length ?? 0,
  }
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/**
 * Validate a backup file and restore it, replacing everything currently
 * stored.
 *
 * The local API key is preserved — a backup never contains one, and silently
 * wiping it would be a nasty surprise.
 */
export async function importBackup(file: File): Promise<BackupCounts> {
  const raw = await file.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('这个文件不是合法的 JSON')
  }

  const result = BackupSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`)
      .join('；')
    throw new Error(`备份文件格式不正确：${issues}`)
  }

  const backup = result.data

  const sources = await Promise.all(
    backup.sources.map(async (source) => {
      const { imageData, ...rest } = source
      if (!imageData?.dataUrl) return { ...rest, image: undefined }

      const { mimeType, base64 } = splitDataUrl(imageData.dataUrl)
      const image = new Blob([fromBase64(base64)], { type: mimeType })
      return { ...rest, image }
    }),
  )

  const memos = await Promise.all(
    (backup.memos ?? []).map(async (memo) => {
      const { handwritingData, ...rest } = memo
      if (!handwritingData?.dataUrl) return { ...rest, handwriting: undefined }

      const { mimeType, base64 } = splitDataUrl(handwritingData.dataUrl)
      const handwriting = new Blob([fromBase64(base64)], { type: mimeType })
      return { ...rest, handwriting }
    }),
  )

  await db.transaction(
    'rw',
    [db.sources, db.concepts, db.cards, db.reviewLogs, db.settings, db.memos],
    async () => {
      await db.sources.clear()
      await db.concepts.clear()
      await db.cards.clear()
      await db.reviewLogs.clear()
      await db.memos.clear()

      await db.sources.bulkPut(sources)
      await db.concepts.bulkPut(backup.concepts)
      await db.cards.bulkPut(backup.cards)
      await db.reviewLogs.bulkPut(backup.reviewLogs)
      if (memos.length > 0) {
        await db.memos.bulkPut(memos)
      }

      if (backup.settings) {
        const current = await db.settings.get('settings')
        await db.settings.put({
          ...backup.settings,
          apiKey: current?.apiKey ?? '',
        })
      }
    },
  )

  return {
    sources: sources.length,
    concepts: backup.concepts.length,
    cards: backup.cards.length,
    reviewLogs: backup.reviewLogs.length,
    memos: backup.memos?.length ?? 0,
  }
}
