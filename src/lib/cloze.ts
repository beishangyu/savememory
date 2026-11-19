/**
 * Cloze (填空题) markers.
 *
 * Three syntaxes are recognised:
 *
 *   {{c1::答案}}   Anki style, with an ordinal
 *   {{答案}}       the plain form the model-generated cards use
 *   [答案]         the short form for hand-written word lists
 *
 * The prompt keeps whatever syntax the user wrote — the markers are only
 * interpreted when the card is displayed.
 */

/** A chunk of a prompt: plain text, or a blank the user has to fill in. */
export type ClozeSegment =
  | { type: 'text'; content: string }
  | { type: 'blank'; content: string; ordinal?: number }

const CLOZE_PATTERN =
  String.raw`\{\{c(\d+)::([^{}]*)\}\}|\{\{([^{}]*)\}\}|\[([^\][]*)\]`

/** A fresh regex per call — the shared `lastIndex` would leak between calls. */
function createClozeRegex(): RegExp {
  return new RegExp(CLOZE_PATTERN, 'g')
}

/**
 * Splits a prompt into plain text and blanks.
 *
 * A marker with empty content is not a blank (`[]`, `{{}}`) and is left as
 * ordinary text.
 */
export function splitCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = []
  const regex = createClozeRegex()
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const content = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    if (!content) continue

    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    segments.push({
      type: 'blank',
      content,
      ordinal: match[1] ? Number(match[1]) : undefined,
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

/** True when the text contains at least one usable blank. */
export function hasCloze(text: string): boolean {
  return splitCloze(text).some((segment) => segment.type === 'blank')
}

/** The blanks of a prompt, in order. */
export function clozeBlanks(text: string): string[] {
  return splitCloze(text)
    .filter((segment): segment is Extract<ClozeSegment, { type: 'blank' }> => segment.type === 'blank')
    .map((segment) => segment.content)
}

/** Replaces every blank with a placeholder — what the user sees before recalling. */
export function maskCloze(text: string, placeholder = '[...]'): string {
  return splitCloze(text)
    .map((segment) => (segment.type === 'text' ? segment.content : placeholder))
    .join('')
}

/** Removes the markers but keeps the hidden content ("I [go] …" → "I go …"). */
export function stripCloze(text: string): string {
  return splitCloze(text).map((segment) => segment.content).join('')
}

/**
 * True when the card's answer is the blanked content itself rather than a
 * translation of the whole sentence.
 *
 * Model-generated cloze cards store the blanked content in `answer`; cards
 * imported from a word list store the Chinese translation there instead.
 */
export function answerIsBlankContent(prompt: string, answer: string): boolean {
  const blanks = clozeBlanks(prompt)
  if (blanks.length === 0) return false
  const trimmed = answer.trim()
  if (!trimmed) return false
  if (blanks.some((blank) => blank === trimmed)) return true
  return blanks.join('') === trimmed
}
