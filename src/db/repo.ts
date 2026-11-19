import { db } from './db'
import type { Card, Concept, Memo, ReviewLog, Settings, Source } from './schema'
import { DEFAULT_SETTINGS } from './schema'

export const sourcesRepo = {
  async list(): Promise<Source[]> {
    return db.sources.orderBy('createdAt').reverse().toArray()
  },
  async get(id: string): Promise<Source | undefined> {
    return db.sources.get(id)
  },
  async put(source: Source): Promise<void> {
    await db.sources.put(source)
  },
  async remove(id: string): Promise<void> {
    await db.transaction('rw', db.sources, db.concepts, db.cards, db.reviewLogs, async () => {
      const cards = await db.cards.where('sourceId').equals(id).toArray()
      const cardIds = cards.map((c) => c.id)
      // `anyOf` throws on an empty array, so only call it when there is work to do.
      if (cardIds.length > 0) {
        await db.reviewLogs.where('cardId').anyOf(cardIds).delete()
      }
      await db.cards.where('sourceId').equals(id).delete()
      await db.concepts.where('sourceId').equals(id).delete()
      await db.sources.delete(id)
    })
  },
}

export const conceptsRepo = {
  async listBySource(sourceId: string): Promise<Concept[]> {
    return db.concepts.where('sourceId').equals(sourceId).sortBy('index')
  },
  async get(id: string): Promise<Concept | undefined> {
    return db.concepts.get(id)
  },
  /** Looks up several concepts at once; missing ones come back as `undefined`. */
  async bulkGet(ids: string[]): Promise<(Concept | undefined)[]> {
    return db.concepts.bulkGet(ids)
  },
  /** Every concept in the library. */
  async listAll(): Promise<Concept[]> {
    return db.concepts.toArray()
  },
  async bulkPut(concepts: Concept[]): Promise<void> {
    await db.concepts.bulkPut(concepts)
  },
}

export const cardsRepo = {
  async get(id: string): Promise<Card | undefined> {
    return db.cards.get(id)
  },
  async bulkGet(ids: string[]): Promise<Card[]> {
    return db.cards.bulkGet(ids).then((rows) => rows.filter((r): r is Card => r !== undefined))
  },
  async bulkPut(cards: Card[]): Promise<void> {
    await db.cards.bulkPut(cards)
  },
  async put(card: Card): Promise<void> {
    await db.cards.put(card)
  },
  async listBySource(sourceId: string): Promise<Card[]> {
    return db.cards.where('sourceId').equals(sourceId).toArray()
  },
  async count(): Promise<number> {
    return db.cards.count()
  },
  /** Every card in the library. */
  async listAll(): Promise<Card[]> {
    return db.cards.toArray()
  },
  /** Cards whose next review is at or before `now`, oldest due first. */
  async listDue(now: number): Promise<Card[]> {
    const due = await db.cards.where('dueAt').belowOrEqual(now).toArray()
    return due.sort((a, b) => a.dueAt - b.dueAt)
  },
  async countDue(now: number): Promise<number> {
    return db.cards.where('dueAt').belowOrEqual(now).count()
  },
  /** Cards due at or before `timestamp` — used for "due today" and forecasts. */
  async listDueUntil(timestamp: number): Promise<Card[]> {
    return db.cards.where('dueAt').belowOrEqual(timestamp).toArray()
  },
  async countDueUntil(timestamp: number): Promise<number> {
    return db.cards.where('dueAt').belowOrEqual(timestamp).count()
  },
  /** The earliest time at which a not-yet-due card becomes due. */
  async nextDueAt(now = Date.now()): Promise<number | undefined> {
    const future = await db.cards.where('dueAt').above(now).sortBy('dueAt')
    return future[0]?.dueAt
  },
}

export const reviewLogsRepo = {
  async get(id: string): Promise<ReviewLog | undefined> {
    return db.reviewLogs.get(id)
  },
  async listByCard(cardId: string): Promise<ReviewLog[]> {
    return db.reviewLogs.where('cardId').equals(cardId).reverse().sortBy('reviewedAt')
  },
  async listRecent(limit = 50): Promise<ReviewLog[]> {
    return db.reviewLogs.orderBy('reviewedAt').reverse().limit(limit).toArray()
  },
  async put(log: ReviewLog): Promise<void> {
    await db.reviewLogs.put(log)
  },
  async count(): Promise<number> {
    return db.reviewLogs.count()
  },
  /** Every review logged at or after `timestamp`, oldest first. */
  async listSince(timestamp: number): Promise<ReviewLog[]> {
    const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(timestamp).toArray()
    return logs.sort((a, b) => a.reviewedAt - b.reviewedAt)
  },
  /** How many reviews were logged at or after `timestamp`. */
  async countSince(timestamp: number): Promise<number> {
    return db.reviewLogs.where('reviewedAt').aboveOrEqual(timestamp).count()
  },
  /** How many reviews were logged between `from` and `to` (both inclusive). */
  async countBetween(from: number, to: number): Promise<number> {
    return db.reviewLogs.where('reviewedAt').between(from, to, true, true).count()
  },
}

export const settingsRepo = {
  async get(): Promise<Settings> {
    const stored = await db.settings.get('settings')
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  },
  async put(settings: Settings): Promise<void> {
    await db.settings.put(settings)
  },
}

export const memosRepo = {
  async list(): Promise<Memo[]> {
    const all = await db.memos.orderBy('updatedAt').reverse().toArray()
    // Pinned first, then most recently touched.
    return all.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  },
  async get(id: string): Promise<Memo | undefined> {
    return db.memos.get(id)
  },
  async put(memo: Memo): Promise<void> {
    await db.memos.put(memo)
  },
  async remove(id: string): Promise<void> {
    await db.memos.delete(id)
  },
  async count(): Promise<number> {
    return db.memos.count()
  },
}
