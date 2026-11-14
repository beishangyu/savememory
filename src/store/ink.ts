import { create } from 'zustand'
import { DEFAULT_INK_COLOR } from '../lib/handwriting'
import { useSettings } from './settings'

interface InkState {
  /** Is the global handwriting overlay active? */
  enabled: boolean
  /** The last pointer type the device reported (for troubleshooting). */
  lastPointerType: string
  /** Whether a stylus has been seen since the overlay was opened. */
  penDetected: boolean

  /** Ink colour, shared by the global overlay and the inline canvas. */
  color: string
  /** How strongly the pen pressure affects the line width (0..1). */
  pressureStrength: number

  toggle: () => void
  setEnabled: (enabled: boolean) => void
  setPointerInfo: (pointerType: string, penDetected: boolean) => void
  setColor: (color: string) => void
  setPressureStrength: (value: number) => void
}

/** Persist the preference so it survives a reload and travels with a backup. */
function persist(patch: { inkColor?: string; inkPressure?: number }) {
  void useSettings.getState().save(patch)
}

export const useInk = create<InkState>((set) => ({
  enabled: false,
  lastPointerType: '',
  penDetected: false,
  color: DEFAULT_INK_COLOR,
  pressureStrength: 1,

  toggle: () => set((state) => ({ enabled: !state.enabled })),
  setEnabled: (enabled) => set({ enabled }),
  setPointerInfo: (lastPointerType, penDetected) => set({ lastPointerType, penDetected }),
  setColor: (color) => {
    set({ color })
    persist({ inkColor: color })
  },
  setPressureStrength: (pressureStrength) => {
    set({ pressureStrength })
    persist({ inkPressure: pressureStrength })
  },
}))
