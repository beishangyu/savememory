import { create } from 'zustand'

interface SyncState {
  /**
   * A sync payload that arrived through the URL fragment (`#sync=…`).
   * The settings page picks it up and offers to merge it.
   */
  pending: string | null
  setPending: (text: string | null) => void
  /** Reads the pending payload and clears it. */
  consume: () => string | null
}

export const useSync = create<SyncState>((set, get) => ({
  pending: null,
  setPending: (text) => set({ pending: text }),
  consume: () => {
    const pending = get().pending
    if (pending) set({ pending: null })
    return pending
  },
}))
