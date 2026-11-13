import { create } from 'zustand'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Settings } from '../db/schema'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  save: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await settingsRepo.get()
    set({ settings, loaded: true })
  },

  save: async (patch) => {
    const next: Settings = { ...get().settings, ...patch, id: 'settings' }
    await settingsRepo.put(next)
    set({ settings: next })
  },
}))

/** Read the current settings outside of React components. */
export function currentSettings(): Settings {
  return useSettings.getState().settings
}
