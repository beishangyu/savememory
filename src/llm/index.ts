import type { Settings } from '../db/schema'
import { createGeminiProvider } from './gemini'
import { createOpenAIProvider } from './openai'
import type { LLMProvider } from './types'

export * from './types'
export { createGeminiProvider } from './gemini'
export { createOpenAIProvider } from './openai'
export { extractImageText, extractionToMaterial } from './vision'
export { judgeAnswer } from './judge'
export type { Judgement } from './judge'

/** Build a provider from the persisted settings. */
export function providerFromSettings(settings: Settings, modelOverride?: string): LLMProvider {
  const model = (modelOverride ?? settings.model).trim()
  if (settings.provider === 'gemini') {
    return createGeminiProvider({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model,
    })
  }
  return createOpenAIProvider({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model,
  })
}

/**
 * Provider used for reading images. Uses the dedicated vision model when one
 * is configured, otherwise falls back to the main model.
 */
export function visionProviderFromSettings(settings: Settings): LLMProvider {
  return providerFromSettings(settings, settings.visionModel.trim() || settings.model)
}

/** Default endpoint for each provider family. */
export const DEFAULT_BASE_URL: Record<Settings['provider'], string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

/** A sensible default model per provider family. */
export const DEFAULT_MODEL: Record<Settings['provider'], string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
}

/** Default model used for reading images, per provider family. */
export const DEFAULT_VISION_MODEL: Record<Settings['provider'], string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
}
