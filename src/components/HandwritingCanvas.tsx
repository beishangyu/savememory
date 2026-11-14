import { useId, useState } from 'react'
import { InkStylePicker } from './InkStylePicker'
import { useInkSurface } from '../hooks/useInkSurface'
import { POINTER_MODE_LABEL, type PointerMode } from '../lib/handwriting'
import { useInk } from '../store/ink'

interface HandwritingCanvasProps {
  /** Called with the current drawing as a PNG blob (null when cleared). */
  onChange?: (blob: Blob | null) => void
  height?: number
  disabled?: boolean
  /** Show the undo / clear / pointer-mode controls. */
  showControls?: boolean
  placeholder?: string
  initialMode?: PointerMode
}

/**
 * An inline pressure-sensitive drawing surface.
 *
 * Built on Pointer Events so the same code path serves Apple Pencil, a mouse
 * and a finger. Coalesced events are used when available, which is what makes
 * a fast Apple Pencil stroke look smooth instead of polygonal.
 */
export function HandwritingCanvas({
  onChange,
  height = 240,
  disabled,
  showControls = true,
  placeholder = '在这里用手写笔作答…',
  initialMode = 'auto',
}: HandwritingCanvasProps) {
  const [mode, setMode] = useState<PointerMode>(initialMode)
  const surfaceId = useId()
  const inkColor = useInk((state) => state.color)
  const setInkColor = useInk((state) => state.setColor)
  const pressureStrength = useInk((state) => state.pressureStrength)
  const setPressureStrength = useInk((state) => state.setPressureStrength)

  const {
    attachCanvas,
    strokeCount,
    penDetected,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    undo,
    clear,
  } = useInkSurface({
    mode,
    scope: 'surface',
    // A unique surface per canvas so two canvases never share ink.
    surfaceId: `inline-${surfaceId}`,
    active: true,
    inkColor,
    pressureStrength,
    onChange,
  })

  const cycleMode = () => {
    setMode((current) => (current === 'auto' ? 'pen' : current === 'pen' ? 'finger' : 'auto'))
  }

  const empty = strokeCount === 0

  return (
    <div className="ink">
      <div className="ink-canvas-wrap">
        <canvas
          ref={attachCanvas}
          className="ink-canvas"
          // Inline, so the surface always owns its gestures.
          style={{ height, touchAction: 'none' }}
          onPointerDown={(event) => {
            if (!disabled) onPointerDown(event)
          }}
          onPointerMove={(event) => {
            if (!disabled) onPointerMove(event)
          }}
          onPointerUp={(event) => {
            if (!disabled) onPointerUp(event)
          }}
          onPointerCancel={(event) => {
            if (!disabled) onPointerUp(event)
          }}
          aria-label="手写区域"
        />
        {empty && <div className="ink-placeholder">{placeholder}</div>}
      </div>

      {showControls && (
        <div className="ink-controls">
          <button
            type="button"
            className="btn btn-small"
            onClick={undo}
            disabled={disabled || empty}
          >
            撤销
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={clear}
            disabled={disabled || empty}
          >
            清空
          </button>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={cycleMode}
            disabled={disabled}
            title="切换防误触策略"
          >
            {POINTER_MODE_LABEL[mode]}
            {penDetected && mode === 'auto' ? '（已检测到笔）' : ''}
          </button>
          <span className="muted small">压感笔迹 · 已启用防误触</span>
        </div>
      )}

      {showControls && (
        <InkStylePicker
          color={inkColor}
          onColorChange={setInkColor}
          pressureStrength={pressureStrength}
          onPressureChange={setPressureStrength}
        />
      )}
    </div>
  )
}
