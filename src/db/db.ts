import Dexie, { type Table } from 'dexie'
import type { Card, Concept, Memo, ReviewLog, Settings, Source } from './schema'

/**
 * The name of the database.
 *
 * In the app it is always `savememory`. The tests hand every file its own
 * name, because the in-memory IndexedDB is shared per process and parallel
 * test files would otherwise wipe each other's data.
 */
export const DB_NAME =
  (globalThis as { __SAVEMEMORY_DB_NAME__?: string }).__SAVEMEMORY_DB_NAME__ ?? 'savememory'

export class MemoryDB extends Dexie {
  sources!: Table<Source, string>
  concepts!: Table<Concept, string>
  cards!: Table<Card, string>
  reviewLogs!: Table<ReviewLog, string>
  settings!: Table<Settings, string>
  memos!: Table<Memo, string>

  constructor() {
    super(DB_NAME)
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
