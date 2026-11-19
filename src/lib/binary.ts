/**
 * Small binary helpers shared by the sync payloads.
 *
 * Everything here is browser-native: `btoa`/`atob` for base64 and
 * `CompressionStream` for deflate — no dependencies.
 */

/** Encodes bytes as base64url (no padding, URL-safe alphabet). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decodes base64url (also accepts standard base64). */
export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** True when the browser can compress and decompress. */
export function supportsCompression(): boolean {
  return (
    typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
  )
}

/** Reads a byte stream into one array. */
async function readAll(stream: ReadableStream<BufferSource>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk =
      value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
    chunks.push(chunk)
    total += chunk.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Wraps bytes in a stream. */
function toStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes as BufferSource)
      controller.close()
    },
  })
}

/** Compresses a string with raw deflate. */
export async function deflate(text: string): Promise<Uint8Array> {
  const stream = toStream(new TextEncoder().encode(text)).pipeThrough(
    new CompressionStream('deflate-raw'),
  )
  return readAll(stream)
}

/** Decompresses raw deflate back into a string. */
export async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = toStream(bytes).pipeThrough(new DecompressionStream('deflate-raw'))
  return new TextDecoder().decode(await readAll(stream))
}
