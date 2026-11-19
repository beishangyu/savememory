import { useMemo } from 'react'
import { splitCloze } from '../lib/cloze'

interface ClozeTextProps {
  /** The prompt, possibly containing cloze markers. */
  prompt: string
  /** Show the hidden content instead of the placeholder. */
  revealed?: boolean
}

/**
 * Renders a cloze prompt.
 *
 * Before the answer is revealed every blank shows as `[...]`; afterwards the
 * folded content is shown highlighted, so the eye lands straight on what had
 * to be recalled.
 */
export function ClozeText({ prompt, revealed = false }: ClozeTextProps) {
  const segments = useMemo(() => splitCloze(prompt), [prompt])

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.content}</span>
        ) : (
          <span
            key={index}
            className={`cloze-blank${revealed ? ' cloze-filled' : ''}`}
          >
            {revealed ? segment.content : '[...]'}
          </span>
        ),
      )}
    </>
  )
}
