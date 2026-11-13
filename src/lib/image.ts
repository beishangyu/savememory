/**
 * Image helpers.
 *
 * Images are stored in IndexedDB as Blobs (no base64 bloat, no 33% overhead)
 * and converted to base64 only at the moment they are sent to a model.
 */

/** Longest edge we keep. Bigger than this wastes tokens without adding OCR accuracy. */
export const MAX_IMAGE_DIMENSION = 2000

/** Refuse absurdly large uploads early rather than after decoding them. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ImagePayload {
  /** Raw base64 without the `data:` prefix. */
  base64: string
  mimeType: string
  /** Full `data:` URL, for providers that want one. */
  dataUrl: string
}

export interface PreparedImage extends ImagePayload {
  blob: Blob
  width: number
  height: number
  size: number
}

/** Split a `data:` URL into its mime type and raw base64 payload. */
export function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return { mimeType: 'image/png', base64: dataUrl }
  const mimeType = match[1] ?? 'image/png'
  const base64 = match[3] ?? ''
  return { mimeType, base64 }
}

/** Encode bytes as base64. Works in browsers and in Node. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Decode a base64 string into bytes. */
export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Read a Blob into a data URL.
 *
 * Prefers `Blob.arrayBuffer()`, but falls back to `FileReader` for
 * environments whose Blob implementation lacks it (some test environments and
 * older browsers).
 */
export async function readAsDataUrl(blob: Blob): Promise<string> {
  const mimeType = blob.type || 'application/octet-stream'

  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer()
    return `data:${mimeType};base64,${toBase64(new Uint8Array(buffer))}`
  }

  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(blob)
    })
  }

  throw new Error('当前环境无法读取图片内容')
}

/** Load a Blob into an HTMLImageElement (used for downscaling). */
function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof URL.createObjectURL !== 'function') {
      reject(new Error('当前环境不支持图片解码'))
      return
    }

    const url = URL.createObjectURL(blob)
    const image = new Image()
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码超时'))
    }, 10_000)

    image.onload = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('无法解码该图片'))
    }
    image.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      mimeType,
      quality,
    )
  })
}

/**
 * Downscale an image so its longest edge is at most `MAX_IMAGE_DIMENSION`.
 *
 * PNG is kept for screenshots (lossless text stays crisp for OCR); photos are
 * re-encoded as JPEG to avoid huge PNG blobs.
 *
 * If the environment cannot decode images (e.g. a test runner), the original
 * blob is returned untouched rather than throwing.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片太大（${(file.size / 1024 / 1024).toFixed(1)} MB），请压缩后再上传`)
  }

  const originalDataUrl = await readAsDataUrl(file)
  const original = splitDataUrl(originalDataUrl)
  const mimeType = file.type || original.mimeType

  const fallback = (): PreparedImage => ({
    blob: file,
    base64: original.base64,
    mimeType,
    dataUrl: originalDataUrl,
    width: 0,
    height: 0,
    size: file.size,
  })

  // Canvas support is what makes downscaling possible. Without it (e.g. in a
  // test environment) we keep the original bytes rather than failing.
  let context: CanvasRenderingContext2D | null = null
  try {
    context = document.createElement('canvas').getContext('2d')
  } catch {
    context = null
  }
  if (!context) return fallback()

  try {
    const image = await loadImageElement(file)
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    )

    if (scale === 1 && mimeType !== 'image/png') {
      // Already small enough and not a PNG: keep the original bytes.
      return {
        blob: file,
        base64: original.base64,
        mimeType,
        dataUrl: originalDataUrl,
        width: image.naturalWidth,
        height: image.naturalHeight,
        size: file.size,
      }
    }

    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback()
    ctx.drawImage(image, 0, 0, width, height)

    const targetMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await toBlob(canvas, targetMime, 0.92)
    const dataUrl = await readAsDataUrl(blob)
    const payload = splitDataUrl(dataUrl)

    return {
      blob,
      base64: payload.base64,
      mimeType: payload.mimeType,
      dataUrl,
      width,
      height,
      size: blob.size,
    }
  } catch {
    // Fall back to the original bytes — better a big image than no image.
    return fallback()
  }
}

/** Create an object URL for displaying a stored image. */
export function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}
