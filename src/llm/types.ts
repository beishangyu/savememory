import type { ProviderKind } from '../db/schema'
import { readAsDataUrl, splitDataUrl } from '../lib/image'

export interface LLMMessage {
  role: 'system' | 'user'
  text: string
  /** Image as a Blob. Converted to base64 internally. */
  image?: Blob
  /** Image as raw base64 (no `data:` prefix). */
  imageBase64?: string
  /** Mime type for `imageBase64`, or for `image` when the Blob type is empty. */
  imageMimeType?: string
}

export interface LLMOptions {
  /** Ask the provider for a JSON object response. */
  json?: boolean
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface LLMProvider {
  kind: ProviderKind
  model: string
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<string>
}

/** An error raised while talking to the model, with enough context to show the user. */
export class LLMError extends Error {
  readonly status?: number
  readonly provider: ProviderKind
  readonly raw?: string
  /**
   * True when the endpoint rejected the request because the configured model
   * cannot read images. The ingest pipeline uses this to offer the manual
   * "type the text yourself" fallback.
   */
  readonly visionUnsupported?: boolean

  constructor(
    message: string,
    options: {
      status?: number
      provider: ProviderKind
      raw?: string
      cause?: unknown
      visionUnsupported?: boolean
    } = { provider: 'openai' },
  ) {
    super(message, { cause: options.cause })
    this.name = 'LLMError'
    this.status = options.status
    this.provider = options.provider
    this.raw = options.raw
    this.visionUnsupported = options.visionUnsupported
  }
}

/** The normalised image payload a provider needs. */
export interface ImagePayload {
  base64: string
  mimeType: string
}

/**
 * Normalise the image carried by a message into a base64 payload.
 *
 * Accepts either a Blob (converted on the fly) or a pre-encoded base64 string.
 */
export async function resolveImagePayload(
  message: LLMMessage,
): Promise<ImagePayload | undefined> {
  if (message.imageBase64) {
    return {
      base64: message.imageBase64,
      mimeType: message.imageMimeType ?? 'image/png',
    }
  }
  if (message.image) {
    const dataUrl = await readAsDataUrl(message.image)
    const { mimeType, base64 } = splitDataUrl(dataUrl)
    return { base64, mimeType: message.imageMimeType ?? mimeType }
  }
  return undefined
}

/**
 * Heuristic: did the endpoint reject our request because the model cannot read
 * images?
 *
 * A false positive is harmless — it only means we offer the manual fallback
 * instead of failing outright.
 */
export function looksLikeVisionError(status: number, raw: string): boolean {
  if (status < 400 || status >= 500) return false
  const mentionsImage = /(image|vision|multimodal|multi-modal|inline_?data|图片|图像|视觉)/i.test(raw)
  const mentionsUnsupported =
    /(not support|unsupported|does not|doesn't|cannot|can't|invalid|not allowed|unknown|unrecognized|not found)/i.test(
      raw,
    )
  return mentionsImage && mentionsUnsupported
}

/** Shared timeout wrapper for `fetch`. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
