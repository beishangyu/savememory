import type { ZodType } from 'zod'
import { extractJson } from '../lib/json'
import { LLMError, type LLMMessage, type LLMProvider } from './types'

export interface CallJsonOptions {
  /** How many extra attempts to make when the output cannot be parsed/validated. */
  retries?: number
  temperature?: number
  maxTokens?: number
}

/**
 * Call the model and validate its JSON output against `schema`.
 *
 * Models frequently wrap JSON in prose or emit a slightly wrong shape. Rather
 * than crashing, we re-ask with a precise error message and finally surface a
 * descriptive `LLMError` so the caller can degrade gracefully.
 */
export async function callJson<T>(
  provider: LLMProvider,
  messages: LLMMessage[],
  schema: ZodType<T>,
  options: CallJsonOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2
  const conversation: LLMMessage[] = [...messages]
  let lastError = '未知错误'
  let lastRaw = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // Transport / HTTP errors are not fixable by re-prompting, so they bubble up.
    const raw = await provider.generate(conversation, {
      json: true,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    })
    lastRaw = raw

    try {
      const parsed = schema.safeParse(extractJson(raw))
      if (parsed.success) return parsed.data

      lastError = `数据校验未通过：${parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`)
        .join('；')}`
    } catch (err) {
      lastError = (err as Error).message
    }

    conversation.push({
      role: 'user',
      text: `上一次的输出无法被解析（${lastError}）。请重新输出严格合法的 JSON，不要包含任何额外文字或说明。`,
    })
  }

  throw new LLMError(`模型输出校验失败（已重试 ${retries} 次）：${lastError}`, {
    provider: provider.kind,
    raw: lastRaw.slice(0, 2000),
  })
}
