import { db } from './db'
import type { Card, Concept, ReviewLog, Settings, Source } from './schema'
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
  /** Cards whose next review is at or before `now`, oldest due first. */
  async listDue(now: number): Promise<Card[]> {
    const due = await db.cards.where('dueAt').belowOrEqual(now).toArray()
    return due.sort((a, b) => a.dueAt - b.dueAt)
  },
  async countDue(now: number): Promise<number> {
    return db.cards.where('dueAt').belowOrEqual(now).count()
  },
}

export const reviewLogsRepo = {
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
