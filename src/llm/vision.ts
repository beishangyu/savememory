import { callJson } from './call'
import { IMAGE_EXTRACTION_PROMPT, SYSTEM_PROMPT } from './prompts'
import { ImageExtractionSchema, type ImageExtractionOutput } from './schemas'
import type { LLMProvider } from './types'

export type ImageExtraction = ImageExtractionOutput

/**
 * Read an image with a vision model and return its text plus a semantic
 * summary.
 *
 * The result becomes the material for the regular
 * "concept -> question -> schedule" pipeline, so a photo and a pasted note
 * are treated identically from here on.
 */
export async function extractImageText(
  provider: LLMProvider,
  image: { base64: string; mimeType: string },
  options: { titleHint?: string } = {},
): Promise<ImageExtraction> {
  const hint = options.titleHint ? `\n用户给这张图片起的名字是：「${options.titleHint}」，可作为标题参考。` : ''

  const extraction = await callJson(
    provider,
    [
      { role: 'system', text: SYSTEM_PROMPT },
      {
        role: 'user',
        text: `${IMAGE_EXTRACTION_PROMPT}${hint}`,
        imageBase64: image.base64,
        imageMimeType: image.mimeType,
      },
    ],
    ImageExtractionSchema,
    { temperature: 0.2, maxTokens: 4000 },
  )

  // The vision model may echo the prompt; keep only what it actually extracted.
  return {
    text: extraction.text ?? '',
    title: extraction.title,
    language: extraction.language,
    hasFormula: extraction.hasFormula,
    semanticSummary: extraction.semanticSummary ?? '',
  }
}

/**
 * Combine the extracted text and the semantic summary into the material used
 * for concept extraction.
 */
export function extractionToMaterial(extraction: ImageExtraction): string {
  const parts: string[] = []
  if (extraction.text.trim()) {
    parts.push(extraction.text.trim())
  }
  if (extraction.semanticSummary.trim()) {
    parts.push(`【图片语义摘要】\n${extraction.semanticSummary.trim()}`)
  }
  return parts.join('\n\n').trim()
}
