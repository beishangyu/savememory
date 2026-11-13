import { useEffect, useRef, useState } from 'react'

interface ImageDropzoneProps {
  onImage: (file: File) => void
  disabled?: boolean
}

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'

/** True when the event target is a text field, where pasting must stay text. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/**
 * Upload area for images: click to browse, drag & drop, or paste a screenshot.
 *
 * Two separate inputs are used on purpose. On iOS, `capture="environment"`
 * opens the camera *instead of* the photo library, so we offer both: a
 * "拍照" button that launches the rear camera, and the drop zone itself which
 * opens the normal picker (library + files).
 */
export function ImageDropzone({ onImage, disabled }: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Paste support: a screenshot can be pasted straight from the clipboard.
  useEffect(() => {
    if (disabled) return

    const handlePaste = (event: ClipboardEvent) => {
      if (isTextEntry(event.target)) return
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return

      const file = Array.from(files).find((item) => item.type.startsWith('image/'))
      if (!file) return

      event.preventDefault()
      onImage(file)
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [disabled, onImage])

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    onImage(file)
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (!disabled) inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) pick(event.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden-input"
        onChange={(event) => {
          pick(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        // Opens the rear camera directly on phones.
        capture="environment"
        className="hidden-input"
        onChange={(event) => {
          pick(event.target.files)
          event.target.value = ''
        }}
      />

      <div className="dropzone-icon" aria-hidden="true">
        ⬆
      </div>
      <p className="dropzone-title">拖拽图片到这里，或点击选择文件</p>
      <p className="muted small">也可以直接 Ctrl/⌘ + V 粘贴截图。支持 PNG / JPEG / WebP / GIF。</p>

      <button
        type="button"
        className="btn btn-small only-mobile"
        onClick={(event) => {
          event.stopPropagation()
          if (!disabled) cameraRef.current?.click()
        }}
        disabled={disabled}
      >
        📷 拍照
      </button>
    </div>
  )
}
