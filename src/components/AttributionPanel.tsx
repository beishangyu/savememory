import type { ErrorCause } from '../db/schema'

const CAUSES: Array<{ key: ErrorCause; label: string; hint: string }> = [
  { key: 'forgotten', label: '忘记了', hint: '学过，但就是想不起来' },
  { key: 'confused', label: '混淆了', hint: '和别的概念搞混了' },
  { key: 'not_understood', label: '没理解', hint: '当初就没搞懂这个概念' },
]

interface AttributionPanelProps {
  onSelect: (cause: ErrorCause) => void
  onSkip: () => void
  busy?: boolean
}

/**
 * Asked after a failed answer.
 *
 * The three causes need different follow-ups: "forgotten" just needs more
 * spacing, "confused" needs contrast against the neighbouring concept, and
 * "not understood" means the card should not count as a lapse at all — the
 * concept has to be re-taught.
 */
export function AttributionPanel({ onSelect, onSkip, busy }: AttributionPanelProps) {
  return (
    <div className="attribution">
      <h2 className="attribution-title">这道题为什么没记住？</h2>
      <p className="muted small">
        记下来能帮你针对性地安排复习。选一个最接近的就行。
      </p>
      <div className="attribution-options">
        {CAUSES.map((cause) => (
          <button
            key={cause.key}
            type="button"
            className="attribution-btn"
            onClick={() => onSelect(cause.key)}
            disabled={busy}
          >
            <span className="attribution-label">{cause.label}</span>
            <span className="attribution-hint">{cause.hint}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-small btn-ghost" onClick={onSkip} disabled={busy}>
        跳过
      </button>
    </div>
  )
}
