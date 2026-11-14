import Dexie, { type Table } from 'dexie'
import type { Card, Concept, Memo, ReviewLog, Settings, Source } from './schema'

export class MemoryDB extends Dexie {
  sources!: Table<Source, string>
  concepts!: Table<Concept, string>
  cards!: Table<Card, string>
  reviewLogs!: Table<ReviewLog, string>
  settings!: Table<Settings, string>
  memos!: Table<Memo, string>

  constructor() {
    super('savememory')
    this.version(1).stores({
      sources: 'id, createdAt, generationStatus',
      concepts: 'id, sourceId, [sourceId+index]',
      cards: 'id, conceptId, sourceId, dueAt, [sourceId+createdAt]',
      reviewLogs: 'id, cardId, conceptId, reviewedAt',
      settings: 'id',
    })
    // v2 adds the memo table. Booleans are not valid IndexedDB keys, so
    // `pinned` is deliberately not indexed.
    this.version(2).stores({
      sources: 'id, createdAt, generationStatus',
      concepts: 'id, sourceId, [sourceId+index]',
      cards: 'id, conceptId, sourceId, dueAt, [sourceId+createdAt]',
      reviewLogs: 'id, cardId, conceptId, reviewedAt',
      settings: 'id',
      memos: 'id, updatedAt',
    })
  }
}

export const db = new MemoryDB()
