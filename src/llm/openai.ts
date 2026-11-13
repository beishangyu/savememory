import type { LLMMessage, LLMOptions, LLMProvider } from './types'
import { fetchWithTimeout, LLMError, looksLikeVisionError, resolveImagePayload } from './types'

export interface OpenAIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Provider for any OpenAI-compatible `/chat/completions` endpoint. */
export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  return {
    kind: 'openai',
    model: config.model,

    async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
      const payloadMessages: unknown[] = []

      for (const message of messages) {
        const image = await resolveImagePayload(message)
        if (!image) {
          payloadMessages.push({ role: message.role, content: message.text })
          continue
        }
        // Vision format for OpenAI-compatible endpoints.
        payloadMessages.push({
          role: message.role,
          content: [
            { type: 'text', text: message.text },
            {
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
            },
          ],
        })
      }

      const body: Record<string, unknown> = {
        model: config.model,
        messages: payloadMessages,
      }
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
      if (options.json) body.response_format = { type: 'json_object' }

      let response: Response
      try {
        response = await fetchWithTimeout(
          `${baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
          },
          options.timeoutMs ?? 90_000,
        )
      } catch (err) {
        throw new LLMError(`无法连接到 ${baseUrl}：${(err as Error).message}`, {
          provider: 'openai',
          cause: err,
        })
      }

      const raw = await response.text()

      if (!response.ok) {
        throw new LLMError(`模型接口返回 ${response.status}：${raw.slice(0, 300)}`, {
          status: response.status,
          provider: 'openai',
          raw,
          visionUnsupported: looksLikeVisionError(response.status, raw),
        })
      }

      let data: {
        choices?: Array<{ message?: { content?: string | null } }>
        error?: { message?: string }
      }
      try {
        data = JSON.parse(raw)
      } catch {
        throw new LLMError('模型返回的内容不是合法 JSON', { provider: 'openai', raw })
      }

      if (data.error?.message) {
        throw new LLMError(`模型接口报错：${data.error.message}`, {
          provider: 'openai',
          raw,
          visionUnsupported: looksLikeVisionError(response.status, raw),
        })
      }

      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new LLMError('模型返回内容为空', { provider: 'openai', raw })
      }
      return content
    },
  }
}
