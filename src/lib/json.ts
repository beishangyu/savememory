/**
 * Extract a JSON value from a model response.
 *
 * Models often wrap JSON in Markdown fences or add prose around it. This
 * tolerates both, and throws a descriptive error when nothing JSON-ish is
 * present so the caller can retry / degrade instead of crashing.
 */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^﻿/, '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to brace scanning
  }

  const start = cleaned.search(/[{[]/)
  if (start === -1) {
    throw new Error('响应中未找到 JSON 内容')
  }

  const open = cleaned[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === open) {
      depth += 1
    } else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(slice)
        } catch (err) {
          throw new Error(`JSON 解析失败: ${(err as Error).message}`)
        }
      }
    }
  }

  throw new Error('JSON 结构不完整（括号未闭合）')
}
