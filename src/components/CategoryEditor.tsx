import { useEffect, useRef, useState } from 'react'
import { normalizeCategory, toggleCategory } from '../services/categories'

interface CategoryEditorProps {
  /** The categories the item currently has. */
  categories: string[]
  /** Every category that exists, offered as suggestions. */
  suggestions?: string[]
  /** Called with the new list whenever it changes. */
  onChange: (categories: string[]) => void
  /** The text on the trigger button. */
  label?: string
  /** Render the trigger as a compact icon instead of a full button. */
  compact?: boolean
}

/**
 * A small inline editor for categories.
 *
 * Click the trigger, type a name, press Enter — the list is updated. The
 * existing categories are shown as chips that can be removed by clicking the
 * little ×.
 */
export function CategoryEditor({
  categories,
  suggestions = [],
  onChange,
  label = '分类',
  compact = false,
}: CategoryEditorProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const commit = () => {
    const clean = normalizeCategory(draft)
    if (clean && !categories.includes(clean)) {
      onChange(toggleCategory(categories, clean))
    }
    setDraft('')
    setOpen(false)
  }

  return (
    <span className="category-editor">
      {categories.map((category) => (
        <span key={category} className="chip chip-category">
          {category}
          <button
            type="button"
            className="chip-remove"
            aria-label={`移除分类 ${category}`}
            onClick={() => onChange(toggleCategory(categories, category))}
          >
            ×
          </button>
        </span>
      ))}

      {open ? (
        <input
          ref={inputRef}
          className="category-input"
          value={draft}
          list="category-suggestions"
          placeholder="输入分类名"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setDraft('')
              setOpen(false)
            }
          }}
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          className={`chip chip-add${compact ? ' chip-add-compact' : ''}`}
          onClick={() => setOpen(true)}
        >
          {compact ? '+' : `+ ${label}`}
        </button>
      )}

      <datalist id="category-suggestions">
        {suggestions
          .filter((name) => !categories.includes(name))
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
    </span>
  )
}
