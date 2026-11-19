import { create } from 'zustand'

interface ScopeState {
  /**
   * The category the next study session is limited to.
   *
   * It is set from the card library — the categories there are the same ones
   * the study page offers — and `null` means "everything that is due".
   */
  category: string | null
  setCategory: (category: string | null) => void
}

export const useScope = create<ScopeState>((set) => ({
  category: null,
  setCategory: (category) => set({ category }),
}))
