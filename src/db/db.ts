import Dexie, { type Table } from 'dexie'
import type { Card, Concept, ReviewLog, Settings, Source } from './schema'

export class MemoryDB extends Dexie {
  sources!: Table<Source, string>
  concepts!: Table<Concept, string>
  cards!: Table<Card, string>
  reviewLogs!: Table<ReviewLog, string>
  settings!: Table<Settings, string>

  constructor() {
    super('savememory')
    this.version(1).stores({
      sources: 'id, createdAt, generationStatus',
      concepts: 'id, sourceId, [sourceId+index]',
      cards: 'id, conceptId, sourceId, dueAt, [sourceId+createdAt]',
      reviewLogs: 'id, cardId, conceptId, reviewedAt',
      settings: 'id',
    })
  }
}

export const db = new MemoryDB()
