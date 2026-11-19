import { db } from '../db/db'
import type { Card, Concept, ReviewLog, Source } from '../db/schema'
import { deflate, fromBase64Url, inflate, supportsCompression, toBase64Url } from '../lib/binary'

/** The prefix of a compressed sync payload. */
export const SYNC_PREFIX_COMPRESSED = 'SM1:'
/** The prefix of an uncompressed sync payload (fallback for old browsers). */
export const SYNC_PREFIX_PLAIN = 'SM0:'

export const SYNC_FORMAT = 'savememory-sync'
export const SYNC_VERSION = 1

/**
 * How much fits into a QR code.
 *
 * The limit is the QR code itself: version 40 in byte mode holds 2953 bytes
 * with error correction level L, 2331 with level M.
 */
export const QR_BYTE_LIMIT = 2953

/** What a payload contains. */
export type SyncTier = 'full' | 'cards'

export interface SyncBundle {
  format: typeof SYNC_FORMAT
  version: number
  /** `full` includes the review history, `cards` only the cards. */
  tier: SyncTier
  exportedAt: number
  sources: Source[]
  concepts: Concept[]
  cards: Card[]
  reviewLogs: ReviewLog[]
}

export interface SyncCounts {
  sources: number
  concepts: number
  cards: number
  reviewLogs: number
}

/**
 * Collects the parts of the library that are worth syncing.
 *
 * Images are left out: a photo does not fit into a QR code, and the WebDAV
 * backup is the place for those.
 */
export async function collectBundle(tier: SyncTier): Promise<SyncBundle> {
  const [sources, concepts, cards, reviewLogs] = await Promise.all([
    db.sources.toArray(),
    db.concepts.toArray(),
    db.cards.toArray(),
    tier === 'full' ? db.reviewLogs.toArray() : Promise.resolve([]),
  ])

  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    tier,
    exportedAt: Date.now(),
    // The picture is dropped; the text is what matters for the vocabulary.
    sources: sources.map(({ image: _image, ...source }) => source),
    concepts,
    cards,
    reviewLogs,
  }
}

/**
 * Serialises a bundle into the text that goes into the QR code.
 */
export async function serializeBundle(bundle: SyncBundle): Promise<string> {
  const json = JSON.stringify(bundle)
  if (supportsCompression()) {
    return SYNC_PREFIX_COMPRESSED + toBase64Url(await deflate(json))
  }
  return SYNC_PREFIX_PLAIN + toBase64Url(new TextEncoder().encode(json))
}

/**
 * Parses a sync payload.
 *
 * Accepts the compressed and the plain form, and also a URL that carries the
 * payload in its fragment (`…#sync=SM1:…`).
 */
export async function parseBundle(text: string): Promise<SyncBundle> {
  const trimmed = extractPayload(text.trim())
  if (!trimmed) throw new Error('这不像是同步数据')

  let json: string
  if (trimmed.startsWith(SYNC_PREFIX_COMPRESSED)) {
    json = await inflate(fromBase64Url(trimmed.slice(SYNC_PREFIX_COMPRESSED.length)))
  } else if (trimmed.startsWith(SYNC_PREFIX_PLAIN)) {
    json = new TextDecoder().decode(fromBase64Url(trimmed.slice(SYNC_PREFIX_PLAIN.length)))
  } else {
    throw new Error('同步数据格式不对')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('同步数据损坏，无法解析')
  }

  const bundle = parsed as Partial<SyncBundle>
  if (bundle.format !== SYNC_FORMAT) throw new Error('这不是本应用的同步数据')
  if (!Array.isArray(bundle.cards) || !Array.isArray(bundle.concepts)) {
    throw new Error('同步数据缺少卡片')
  }

  return {
    format: SYNC_FORMAT,
    version: bundle.version ?? SYNC_VERSION,
    tier: bundle.tier === 'cards' ? 'cards' : 'full',
    exportedAt: bundle.exportedAt ?? Date.now(),
    sources: Array.isArray(bundle.sources) ? bundle.sources : [],
    concepts: bundle.concepts,
    cards: bundle.cards,
    reviewLogs: Array.isArray(bundle.reviewLogs) ? bundle.reviewLogs : [],
  }
}

/** Pulls the payload out of a raw string or a URL. */
export function extractPayload(text: string): string {
  if (!text) return ''
  if (text.startsWith(SYNC_PREFIX_COMPRESSED) || text.startsWith(SYNC_PREFIX_PLAIN)) {
    return text
  }
  // A link that carries the payload in the fragment.
  const hash = text.indexOf('#sync=')
  if (hash >= 0) return text.slice(hash + '#sync='.length)
  const query = text.indexOf('?sync=')
  if (query >= 0) return text.slice(query + '?sync='.length)
  return ''
}

/**
 * Wraps a payload into a link that opens this app.
 *
 * Scanning such a link with the phone camera goes straight to the app, which
 * then offers to merge the data. When the app is not served over http (a local
 * file, for example) the raw payload is returned instead.
 */
export function buildSyncLink(payload: string): string {
  if (typeof window === 'undefined') return payload
  const { origin, pathname } = window.location
  if (!origin || !origin.startsWith('http')) return payload
  return `${origin}${pathname}#sync=${payload}`
}

export interface SyncResult extends SyncCounts {
  /** Rows that already existed and were updated with the incoming progress. */
  updated: number
}

/**
 * Merges a bundle into the local database.
 *
 * Nothing is deleted: rows that already exist keep their identity, and cards
 * take the state with the most progress — so syncing from a phone that is
 * further ahead never rewinds the desktop.
 */
export async function applyBundle(bundle: SyncBundle): Promise<SyncResult> {
  const [existingSources, existingConcepts, existingCards, existingLogs] = await Promise.all([
    db.sources.toArray(),
    db.concepts.toArray(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
  ])

  const sourceIds = new Set(existingSources.map((row) => row.id))
  const conceptIds = new Set(existingConcepts.map((row) => row.id))
  const cardById = new Map(existingCards.map((row) => [row.id, row]))
  const logIds = new Set(existingLogs.map((row) => row.id))

  const newSources = bundle.sources.filter((row) => !sourceIds.has(row.id))
  const newConcepts = bundle.concepts.filter((row) => !conceptIds.has(row.id))
  const newLogs = bundle.reviewLogs.filter((row) => !logIds.has(row.id))

  const cardsToAdd: Card[] = []
  const cardsToUpdate: Card[] = []
  let updated = 0

  for (const card of bundle.cards) {
    const existing = cardById.get(card.id)
    if (!existing) {
      cardsToAdd.push(card)
      continue
    }
    // The version that has been reviewed more often wins.
    if (card.reps > existing.reps) {
      cardsToUpdate.push({ ...existing, ...card })
      updated += 1
    }
  }

  await db.transaction(
    'rw',
    [db.sources, db.concepts, db.cards, db.reviewLogs],
    async () => {
      if (newSources.length > 0) await db.sources.bulkPut(newSources)
      if (newConcepts.length > 0) await db.concepts.bulkPut(newConcepts)
      if (cardsToAdd.length > 0) await db.cards.bulkPut(cardsToAdd)
      if (cardsToUpdate.length > 0) await db.cards.bulkPut(cardsToUpdate)
      if (newLogs.length > 0) await db.reviewLogs.bulkPut(newLogs)
    },
  )

  return {
    sources: newSources.length,
    concepts: newConcepts.length,
    cards: cardsToAdd.length + cardsToUpdate.length,
    reviewLogs: newLogs.length,
    updated,
  }
}

/**
 * Builds the smallest payload that still fits into a QR code.
 *
 * The full bundle is tried first; if it does not fit, the review history is
 * dropped — the vocabulary and the progress are what matter.
 */
export async function buildSyncPayload(): Promise<{
  text: string
  tier: SyncTier
  counts: SyncCounts
  size: number
}> {
  const full = await collectBundle('full')
  const fullText = await serializeBundle(full)
  if (fullText.length <= QR_BYTE_LIMIT) {
    return {
      text: fullText,
      tier: 'full',
      counts: countBundle(full),
      size: fullText.length,
    }
  }

  const cards = await collectBundle('cards')
  const cardsText = await serializeBundle(cards)
  if (cardsText.length > QR_BYTE_LIMIT) {
    throw new Error(
      `数据太大，二维码装不下（需要 ${cardsText.length} 字节，最多 ${QR_BYTE_LIMIT} 字节）。` +
        '请改用下面的 WebDAV 云备份。',
    )
  }

  return {
    text: cardsText,
    tier: 'cards',
    counts: countBundle(cards),
    size: cardsText.length,
  }
}

function countBundle(bundle: SyncBundle): SyncCounts {
  return {
    sources: bundle.sources.length,
    concepts: bundle.concepts.length,
    cards: bundle.cards.length,
    reviewLogs: bundle.reviewLogs.length,
  }
}
