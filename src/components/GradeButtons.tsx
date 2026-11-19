import type { ReviewGrade } from '../db/schema'
import { GRADE_HINT, GRADE_LABEL, GRADE_LABEL_EN, GRADE_ORDER } from '../fsrs/scheduler'

interface GradeButtonsProps {
  onGrade: (grade: ReviewGrade) => void
  disabled?: boolean
  /** Optional "next review in X" preview per grade. */
  preview?: Record<ReviewGrade, number> | null
  formatPreview?: (timestamp: number) => string
  /** The grade the AI suggested. Highlighted, but the user stays in control. */
  suggested?: ReviewGrade | null
  /** Show the keyboard shortcut under each button. */
  showShortcuts?: boolean
}

export function GradeButtons({
  onGrade,
  disabled,
  preview,
  formatPreview,
  suggested,
  showShortcuts,
}: GradeButtonsProps) {
  return (
    <div className="grade-row">
      {GRADE_ORDER.map((grade, index) => (
        <button
          key={grade}
          type="button"
          className={`grade-btn grade-${grade} ${suggested === grade ? 'suggested' : ''}`}
          onClick={() => onGrade(grade)}
          disabled={disabled}
          aria-pressed={suggested === grade}
          aria-keyshortcuts={showShortcuts ? String(index + 1) : undefined}
        >
          <span className="grade-label">{GRADE_LABEL[grade]}</span>
          <span className="grade-hint">{GRADE_HINT[grade]}</span>
          {suggested === grade && <span className="grade-tag">AI 建议</span>}
          {preview && formatPreview && (
            <span className="grade-preview">{formatPreview(preview[grade])}</span>
          )}
          {showShortcuts && (
            <span className="grade-shortcut" aria-hidden="true">
              {index + 1} - {GRADE_LABEL_EN[grade]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
