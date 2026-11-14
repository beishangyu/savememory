import { INK_PALETTE } from '../lib/handwriting'

interface InkStylePickerProps {
  color: string
  onColorChange: (color: string) => void
  /** 0..1 — how strongly the pen pressure affects the line width. */
  pressureStrength: number
  onPressureChange: (value: number) => void
  /** Show the pressure slider (hidden in very tight layouts). */
  showPressure?: boolean
}

/**
 * Ink style controls: colour and pressure sensitivity.
 *
 * Shared by the global overlay and the inline canvas so a colour picked in one
 * place applies everywhere.
 */
export function InkStylePicker({
  color,
  onColorChange,
  pressureStrength,
  onPressureChange,
  showPressure = true,
}: InkStylePickerProps) {
  return (
    <div className="ink-style">
      <div className="ink-swatches" role="group" aria-label="墨色">
        {INK_PALETTE.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`ink-swatch ${color.toLowerCase() === swatch.toLowerCase() ? 'active' : ''}`}
            style={{ background: swatch }}
            onClick={() => onColorChange(swatch)}
            aria-label={`墨色 ${swatch}`}
            aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
          />
        ))}

        <label className="ink-swatch ink-swatch-custom" title="自定义颜色">
          <input
            type="color"
            value={color}
            onChange={(event) => onColorChange(event.target.value)}
            aria-label="自定义墨色"
          />
          <span aria-hidden="true">＋</span>
        </label>
      </div>

      {showPressure && (
        <label className="ink-pressure">
          <span className="ink-pressure-label">压感</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(pressureStrength * 100)}
            onChange={(event) => onPressureChange(Number(event.target.value) / 100)}
            aria-label="压感强度"
          />
          <span className="ink-pressure-value">{Math.round(pressureStrength * 100)}%</span>
        </label>
      )}
    </div>
  )
}
