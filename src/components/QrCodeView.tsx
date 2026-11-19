import { useMemo } from 'react'
import type { QrCode } from '../lib/qrcode'

interface QrCodeViewProps {
  code: QrCode
  /** The rendered width in pixels. */
  size?: number
  /** The quiet zone around the code, in modules. The standard asks for 4. */
  margin?: number
  /** Accessible description. */
  title?: string
}

/**
 * Draws a QR code as an SVG.
 *
 * The dark modules are merged into a single path, so the whole code is one
 * element no matter how dense it gets.
 */
export function QrCodeView({
  code,
  size = 320,
  margin = 4,
  title = '同步二维码',
}: QrCodeViewProps) {
  const path = useMemo(() => {
    const parts: string[] = []
    for (let row = 0; row < code.size; row += 1) {
      for (let col = 0; col < code.size; col += 1) {
        if (code.modules[row][col]) parts.push(`M${col} ${row}h1v1h-1z`)
      }
    }
    return parts.join('')
  }, [code])

  const viewSize = code.size + margin * 2

  return (
    <svg
      className="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
    >
      <rect width={viewSize} height={viewSize} fill="#ffffff" />
      <g transform={`translate(${margin} ${margin})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  )
}
