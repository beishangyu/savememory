import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { InkStylePicker } from './InkStylePicker'
import { useInkSurface } from '../hooks/useInkSurface'
import { useInk } from '../store/ink'
import { buildLabel } from '../version'

/**
 * Global handwriting overlay.
 *
 * A transparent canvas that floats above the whole app, so you can write on
 * top of anything you are looking at. It does not need to be saved — there is
 * an optional button that downloads the current drawing as a PNG.
 *
 * The canvas is `pointer-events: none` and the pointer events are captured on
 * the window. That is deliberate: the page therefore keeps its **native**
 * scrolling behaviour on every vendor's browser, and a finger in pen mode is
 * simply not accepted — so it scrolls the page and never leaves ink. No
 * reliance on `touch-action` semantics that differ between iPad Safari,
 * Chrome on Android and HarmonyOS browsers.
 */
export function GlobalInkLayer() {
  const enabled = useInk((state) => state.enabled)
  const setPointerInfo = useInk((state) => state.setPointerInfo)
  const inkColor = useInk((state) => state.color)
  const setInkColor = useInk((state) => state.setColor)
  const pressureStrength = useInk((state) => state.pressureStrength)
  const setPressureStrength = useInk((state) => state.setPressureStrength)

  /**
   * The gesture policy — stylus only, finger keeps scrolling, a palm cannot
   * hijack the pen — lives in `useInkSurface`, so there is exactly one
   * implementation shared with the inline canvas.
   */

  const {
    attachCanvas,
    strokeCount,
    penDetected,
    lastPointerType,
    size,
    offset,
    stats,
    mountCount,
    undo,
    clear,
    toBlob,
  } = useInkSurface({
    // Stylus only. A finger is never accepted, so it keeps scrolling and
    // tapping exactly as it does without the overlay.
    mode: 'pen',
    scope: 'document',
    surfaceId: 'global',
    // Only listen while the overlay is actually open — otherwise every click
    // on the app (including the button that opens it) would leave a stroke.
    active: enabled,
    inkColor,
    pressureStrength,
    baseWidth: 2.4,
    maxWidth: 7,
  })

  // Surface what the device actually reports — the pointer type differs
  // between vendors and is the first thing to check when the pen misbehaves.
  useEffect(() => {
    setPointerInfo(lastPointerType, penDetected)
  }, [lastPointerType, penDetected, setPointerInfo])

  // Closing the overlay throws the ink away: it is a transient annotation
  // layer, not a drawing the user wants to keep.
  const wasEnabled = useRef(enabled)
  useEffect(() => {
    if (wasEnabled.current && !enabled) clear()
    wasEnabled.current = enabled
  }, [enabled, clear])

  const handleSave = async () => {
    const blob = await toBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const link = document.createElement('a')
    link.href = url
    link.download = `手写标注-${stamp}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {enabled && (
        <>
          {/*
            The canvas is portalled to <body> so that no ancestor can become
            its containing block for `position: fixed` — a transform or a filter
            on any ancestor would otherwise make the overlay scroll along with
            the page.
          */}
          {createPortal(
            <canvas
              ref={attachCanvas}
              className="ink-overlay"
              aria-label="全局手写区域"
              // The canvas only displays the ink; the pointer events are
              // captured on the window so the page keeps scrolling natively.
              style={{ pointerEvents: 'none', touchAction: 'none' }}
            />,
            document.body,
          )}

          <div className="ink-overlay-panel">
            <div className="ink-overlay-toolbar" role="toolbar" aria-label="手写工具">
            <span className="ink-mode-tag">仅手写笔可书写 · 手指可正常滑动与点击</span>
            <button
              type="button"
              className="btn btn-small"
              onClick={undo}
              disabled={strokeCount === 0}
            >
              撤销
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={clear}
              disabled={strokeCount === 0}
            >
              清空
            </button>
            <button type="button" className="btn btn-small" onClick={handleSave}>
              保存
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => useInk.getState().setEnabled(false)}
            >
              关闭
            </button>

            {lastPointerType && (
              <span className="muted small">
                指针类型：{lastPointerType}
                {penDetected ? '（已检测到手写笔）' : ''}
              </span>
            )}
            {size.width > 0 && (
              <span className="muted small">
                画布：{size.width}×{size.height}
                {(offset.x !== 0 || offset.y !== 0) && (
                  <span className="ink-drift"> · 漂移 {offset.x},{offset.y}</span>
                )}
              </span>
            )}
            <span className="muted small ink-stats">
              事件 ↓{stats.down} →{stats.move} ⟂{stats.raw} ↑{stats.up} ✕{stats.cancel} ｜ 笔画{' '}
              {stats.strokes}（点 {stats.points}）｜挂载 {mountCount}
            </span>
            <span className="muted small ink-build">{buildLabel()}</span>
            </div>

            <div className="ink-overlay-style">
              <InkStylePicker
                color={inkColor}
                onColorChange={setInkColor}
                pressureStrength={pressureStrength}
                onPressureChange={setPressureStrength}
              />
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        className={`ink-fab ${enabled ? 'active' : ''}`}
        onClick={() => useInk.getState().toggle()}
        title={enabled ? '关闭全局手写' : '打开全局手写'}
        aria-label={enabled ? '关闭全局手写' : '打开全局手写'}
        aria-pressed={enabled}
      >
        {enabled ? '✕' : '✍'}
      </button>
    </>
  )
}
