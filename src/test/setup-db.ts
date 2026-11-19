/**
 * Give every test file its own database.
 *
 * The in-memory IndexedDB that `fake-indexeddb` provides is shared per
 * process, so two test files running side by side would otherwise use the
 * same database — and one's `delete()` would wipe the other's data.
 *
 * This module has to be imported *before* anything that touches `db.ts`,
 * which is why it is a separate file listed first in the setup files.
 */
const name = `savememory-test-${Math.random().toString(36).slice(2)}`

;(globalThis as { __SAVEMEMORY_DB_NAME__?: string }).__SAVEMEMORY_DB_NAME__ = name

export const TEST_DB_NAME = name
