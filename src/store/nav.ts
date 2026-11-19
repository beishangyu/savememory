import { create } from 'zustand'
import type { TabKey } from '../components/TabBar'

interface NavState {
  /** The page that is currently shown. */
  route: TabKey
  setRoute: (route: TabKey) => void
}

/**
 * The current page.
 *
 * It lives in a store rather than in `App`'s state so that a page can send
 * the user to another one — the library hands over to the study page when you
 * start a category session.
 */
export const useNav = create<NavState>((set) => ({
  route: 'ingest',
  setRoute: (route) => set({ route }),
}))
