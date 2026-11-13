import type { ReviewGrade } from '../db/schema'
import { GRADE_HINT, GRADE_LABEL, GRADE_ORDER } from '../fsrs/scheduler'

interface GradeButtonsProps {
  onGrade: (grade: ReviewGrade) => void
  disabled?: boolean
  /** Optional "next review in X" preview per grade. */
  preview?: Record<ReviewGrade, number> | null
  formatPreview?: (timestamp: number) => string
  /** The grade the AI suggested. Highlighted, but the user stays in control. */
  suggested?: ReviewGrade | null
}

export function GradeButtons({
  onGrade,
  disabled,
  preview,
  formatPreview,
  suggested,
}: GradeButtonsProps) {
  return (
    <div className="grade-row">
      {GRADE_ORDER.map((grade) => (
        <button
          key={grade}
          type="button"
          className={`grade-btn grade-${grade} ${suggested === grade ? 'suggested' : ''}`}
          onClick={() => onGrade(grade)}
          disabled={disabled}
          aria-pressed={suggested === grade}
        >
          <span className="grade-label">{GRADE_LABEL[grade]}</span>
          <span className="grade-hint">{GRADE_HINT[grade]}</span>
          {suggested === grade && <span className="grade-tag">AI 建议</span>}
          {preview && formatPreview && (
            <span className="grade-preview">{formatPreview(preview[grade])}</span>
          )}
        </button>
      ))}
    </div>
  )
}
