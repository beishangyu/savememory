import type { LLMMessage, LLMOptions, LLMProvider } from './types'
import { fetchWithTimeout, LLMError, looksLikeVisionError, resolveImagePayload } from './types'

export interface GeminiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Provider for the Google Gemini `generateContent` endpoint. */
export function createGeminiProvider(config: GeminiConfig): LLMProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  return {
    kind: 'gemini',
    model: config.model,

    async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
      const systemParts: Array<{ text: string }> = []
      const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []

      for (const message of messages) {
        if (message.role === 'system') {
          systemParts.push({ text: message.text })
          continue
        }

        const parts: Array<Record<string, unknown>> = [{ text: message.text }]
        const image = await resolveImagePayload(message)
        if (image) {
          // Vision format for Gemini.
          parts.push({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })
        }
        contents.push({ role: 'user', parts })
      }

      const generationConfig: Record<string, unknown> = {}
      if (options.temperature !== undefined) generationConfig.temperature = options.temperature
      if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens
      if (options.json) generationConfig.responseMimeType = 'application/json'

      const body: Record<string, unknown> = {
        contents,
        generationConfig,
      }
      if (systemParts.length > 0) {
        body.systemInstruction = { parts: systemParts }
      }

      let response: Response
      try {
        response = await fetchWithTimeout(
          `${baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify(body),
          },
          options.timeoutMs ?? 90_000,
        )
      } catch (err) {
        throw new LLMError(`无法连接到 ${baseUrl}：${(err as Error).message}`, {
          provider: 'gemini',
          cause: err,
        })
      }

      const raw = await response.text()

      if (!response.ok) {
        throw new LLMError(`模型接口返回 ${response.status}：${raw.slice(0, 300)}`, {
          status: response.status,
          provider: 'gemini',
          raw,
          visionUnsupported: looksLikeVisionError(response.status, raw),
        })
      }

      let data: {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        promptFeedback?: { blockReason?: string }
        error?: { message?: string }
      }
      try {
        data = JSON.parse(raw)
      } catch {
        throw new LLMError('模型返回的内容不是合法 JSON', { provider: 'gemini', raw })
      }

      if (data.error?.message) {
        throw new LLMError(`模型接口报错：${data.error.message}`, {
          provider: 'gemini',
          raw,
          visionUnsupported: looksLikeVisionError(response.status, raw),
        })
      }
      if (data.promptFeedback?.blockReason) {
        throw new LLMError(`请求被模型拦截：${data.promptFeedback.blockReason}`, {
          provider: 'gemini',
          raw,
        })
      }

      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim()

      if (!text) {
        throw new LLMError('模型返回内容为空', { provider: 'gemini', raw })
      }
      return text
    },
  }
}
