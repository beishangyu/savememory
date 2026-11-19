/**
 * A minimal QR Code encoder (byte mode).
 *
 * Written from scratch so the app keeps a zero-dependency footprint: the
 * payload is written by us, so we only need one mode (byte) and the four
 * error-correction levels.
 *
 * The output is a plain boolean matrix — the caller decides how to draw it.
 */

/** Error correction level. Higher levels survive more damage but need more modules. */
export type QcEcLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrCode {
  /** The module matrix. `true` is a dark module. */
  modules: boolean[][]
  /** The width and height in modules. */
  size: number
  /** The QR version that was used (1–40). */
  version: number
  /** The error correction level that was used. */
  ecLevel: QcEcLevel
  /**
   * Which modules carry function patterns (finder, timing, format …).
   * Data modules are the ones that are `false`.
   */
  isFunction: boolean[][]
  /** The mask pattern that was applied (0–7). */
  mask: number
}

/* ── tables ─────────────────────────────────────────────────────────── */

/** Error correction codewords per block, indexed by version (1–40). */
const ECC_CODEWORDS_PER_BLOCK: Record<QcEcLevel, number[]> = {
  L: [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28,
  ],
  Q: [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
    30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30,
  ],
  H: [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
    28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30,
  ],
}

/** Number of error correction blocks, indexed by version (1–40). */
const NUM_ECC_BLOCKS: Record<QcEcLevel, number[]> = {
  L: [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12,
    12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18,
    20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23,
    25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25,
    34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
}

/** The format bits that identify the error correction level. */
const EC_FORMAT_BITS: Record<QcEcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 }

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10

/* ── capacity ───────────────────────────────────────────────────────── */

/** Number of data modules (before error correction) for a version. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

/** Total number of codewords (data + error correction) for a version. */
function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8)
}

/** How many codewords are available for data at this version and level. */
function dataCodewords(version: number, ecLevel: QcEcLevel): number {
  const blocks = NUM_ECC_BLOCKS[ecLevel][version]
  const ecPerBlock = ECC_CODEWORDS_PER_BLOCK[ecLevel][version]
  return totalCodewords(version) - blocks * ecPerBlock
}

/** Byte mode counts the length in 8 bits up to version 9, 16 bits above. */
function lengthBits(version: number): number {
  return version <= 9 ? 8 : 16
}

/** The largest payload a version/level combination can hold, in bytes. */
export function maxPayloadBytes(version: number, ecLevel: QcEcLevel): number {
  const capacityBits = dataCodewords(version, ecLevel) * 8
  const headerBits = 4 + lengthBits(version)
  return Math.max(0, Math.floor((capacityBits - headerBits) / 8))
}

/**
 * The lookup tables must cover every version — a missing entry would silently
 * produce `NaN` capacities and a broken code. The check runs once, at import.
 */
function assertTables(): void {
  for (const level of ['L', 'M', 'Q', 'H'] as QcEcLevel[]) {
    if (ECC_CODEWORDS_PER_BLOCK[level].length !== 41) {
      throw new Error(`二维码纠错表长度错误：${level}`)
    }
    if (NUM_ECC_BLOCKS[level].length !== 41) {
      throw new Error(`二维码分块表长度错误：${level}`)
    }
  }
}

assertTables()

/* ── bit stream ─────────────────────────────────────────────────────── */

class BitBuffer {
  readonly bits: number[] = []

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1)
    }
  }
}

/** UTF-8 encode without depending on TextEncoder quirks. */
function toUtf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/**
 * Builds the raw data codewords: mode, length, payload, terminator and the
 * alternating padding bytes.
 */
function buildDataCodewords(bytes: number[], version: number, ecLevel: QcEcLevel): number[] {
  const capacity = dataCodewords(version, ecLevel)
  const buffer = new BitBuffer()

  buffer.append(0b0100, 4) // byte mode
  buffer.append(bytes.length, lengthBits(version))
  for (const byte of bytes) buffer.append(byte, 8)

  const capacityBits = capacity * 8
  // Terminator: up to four zero bits.
  buffer.append(0, Math.min(4, capacityBits - buffer.bits.length))
  // Pad to a byte boundary.
  if (buffer.bits.length % 8 !== 0) {
    buffer.append(0, 8 - (buffer.bits.length % 8))
  }

  const codewords: number[] = []
  for (let i = 0; i < buffer.bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buffer.bits[i + j]
    codewords.push(byte)
  }

  // The padding bytes alternate 0xEC and 0x11.
  for (let i = 0; codewords.length < capacity; i += 1) {
    codewords.push(i % 2 === 0 ? 0xec : 0x11)
  }
  return codewords
}

/* ── Reed-Solomon ───────────────────────────────────────────────────── */

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const byte of data) {
    const factor = byte ^ result[0]
    result.shift()
    result.push(0)
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor)
    }
  }
  return result
}

/**
 * Splits the data into blocks, adds error correction and interleaves
 * everything the way the standard asks for: all data columns first, then all
 * error correction columns.
 */
function addEccAndInterleave(data: number[], version: number, ecLevel: QcEcLevel): number[] {
  const numBlocks = NUM_ECC_BLOCKS[ecLevel][version]
  const ecPerBlock = ECC_CODEWORDS_PER_BLOCK[ecLevel][version]
  const rawCodewords = totalCodewords(version)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)

  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []

  let offset = 0
  for (let i = 0; i < numBlocks; i += 1) {
    // The short blocks carry one codeword less than the long ones.
    const dataCount = shortBlockLen - ecPerBlock + (i < numShortBlocks ? 0 : 1)
    const block = data.slice(offset, offset + dataCount)
    offset += dataCount
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, rsDivisor(ecPerBlock)))
  }

  const result: number[] = []
  const maxDataCount = Math.max(...dataBlocks.map((block) => block.length))
  for (let i = 0; i < maxDataCount; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i])
    }
  }
  const maxEcCount = Math.max(...ecBlocks.map((block) => block.length))
  for (let i = 0; i < maxEcCount; i += 1) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i])
    }
  }
  return result
}

/* ── matrix ─────────────────────────────────────────────────────────── */

function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return []
  const numAlign = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result: number[] = [6]
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos)
  }
  return result
}

class Matrix {
  readonly modules: boolean[][]
  readonly isFunction: boolean[][]
  readonly size: number

  constructor(size: number) {
    this.size = size
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark
    this.isFunction[y][x] = true
  }

  setData(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark
  }

  get(x: number, y: number): boolean {
    return this.modules[y][x]
  }
}

function drawFinderPattern(matrix: Matrix, centerX: number, centerY: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centerX + dx
      const y = centerY + dy
      if (x < 0 || x >= matrix.size || y < 0 || y >= matrix.size) continue
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      matrix.setFunction(x, y, distance !== 2 && distance !== 4)
    }
  }
}

function drawAlignmentPattern(matrix: Matrix, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      matrix.setFunction(
        centerX + dx,
        centerY + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      )
    }
  }
}

function drawFormatBits(matrix: Matrix, ecLevel: QcEcLevel, mask: number): void {
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412

  const bit = (index: number) => ((bits >>> index) & 1) !== 0

  // First copy, around the top-left finder pattern.
  for (let i = 0; i <= 5; i += 1) matrix.setFunction(8, i, bit(i))
  matrix.setFunction(8, 7, bit(6))
  matrix.setFunction(8, 8, bit(7))
  matrix.setFunction(7, 8, bit(8))
  for (let i = 9; i < 15; i += 1) matrix.setFunction(14 - i, 8, bit(i))

  // Second copy, split between the other two finder patterns.
  for (let i = 0; i < 8; i += 1) matrix.setFunction(matrix.size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i += 1) matrix.setFunction(8, matrix.size - 15 + i, bit(i))

  // The always-dark module.
  matrix.setFunction(8, matrix.size - 8, true)
}

function drawVersionBits(matrix: Matrix, version: number): void {
  if (version < 7) return
  let rem = version
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  const bits = (version << 12) | rem

  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) !== 0
    const a = matrix.size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    matrix.setFunction(a, b, bit)
    matrix.setFunction(b, a, bit)
  }
}

function drawFunctionPatterns(matrix: Matrix, version: number, ecLevel: QcEcLevel): void {
  const size = matrix.size

  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    matrix.setFunction(6, i, i % 2 === 0)
    matrix.setFunction(i, 6, i % 2 === 0)
  }

  // Finder patterns (with their separators).
  drawFinderPattern(matrix, 3, 3)
  drawFinderPattern(matrix, size - 4, 3)
  drawFinderPattern(matrix, 3, size - 4)

  // Alignment patterns, skipping the three that would overlap a finder.
  const positions = alignmentPatternPositions(version)
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const last = positions.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      drawAlignmentPattern(matrix, positions[i], positions[j])
    }
  }

  // The format bits are drawn twice; the mask is applied later, so a dummy
  // value is enough here.
  drawFormatBits(matrix, ecLevel, 0)
  drawVersionBits(matrix, version)
}

function drawCodewords(matrix: Matrix, codewords: number[]): void {
  const size = matrix.size
  let index = 0

  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern is skipped.
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!matrix.isFunction[y][x] && index < codewords.length * 8) {
          matrix.setData(x, y, ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0)
          index += 1
        }
      }
    }
  }
}

/* ── masking ────────────────────────────────────────────────────────── */

/** True when the module at (x, y) is flipped by the given mask pattern. */
export function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

function applyMask(matrix: Matrix, mask: number): void {
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.isFunction[y][x] && maskAt(mask, x, y)) {
        matrix.setData(x, y, !matrix.get(x, y))
      }
    }
  }
}

function finderPenaltyAddHistory(runLength: number, history: number[]): void {
  if (history[0] === 0) runLength += matrixSizeCache
  history.pop()
  history.unshift(runLength)
}

function finderPenaltyCountPatterns(history: number[]): number {
  const n = history[1]
  const core =
    n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  )
}

function finderPenaltyTerminate(currentColor: boolean, currentLength: number, history: number[]): number {
  let length = currentLength
  if (currentColor) {
    finderPenaltyAddHistory(length, history)
    length = 0
  }
  length += matrixSizeCache
  finderPenaltyAddHistory(length, history)
  return finderPenaltyCountPatterns(history)
}

/** Set by `encodeQr` before the penalty scoring runs. */
let matrixSizeCache = 0

function penaltyScore(matrix: Matrix): number {
  const size = matrix.size
  let result = 0

  // Rule 1: runs of five or more same-coloured modules in a row.
  for (let y = 0; y < size; y += 1) {
    let runColor = false
    let runLength = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    for (let x = 0; x < size; x += 1) {
      if (matrix.get(x, y) === runColor) {
        runLength += 1
        if (runLength === 5) result += PENALTY_N1
        else if (runLength > 5) result += 1
      } else {
        finderPenaltyAddHistory(runLength, history)
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3
        runColor = matrix.get(x, y)
        runLength = 1
      }
    }
    result += finderPenaltyTerminate(runColor, runLength, history) * PENALTY_N3
  }

  // The same, down the columns.
  for (let x = 0; x < size; x += 1) {
    let runColor = false
    let runLength = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    for (let y = 0; y < size; y += 1) {
      if (matrix.get(x, y) === runColor) {
        runLength += 1
        if (runLength === 5) result += PENALTY_N1
        else if (runLength > 5) result += 1
      } else {
        finderPenaltyAddHistory(runLength, history)
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3
        runColor = matrix.get(x, y)
        runLength = 1
      }
    }
    result += finderPenaltyTerminate(runColor, runLength, history) * PENALTY_N3
  }

  // Rule 2: 2×2 blocks of the same colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = matrix.get(x, y)
      if (
        color === matrix.get(x + 1, y) &&
        color === matrix.get(x, y + 1) &&
        color === matrix.get(x + 1, y + 1)
      ) {
        result += PENALTY_N2
      }
    }
  }

  // Rule 4: the balance between dark and light modules.
  let dark = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix.get(x, y)) dark += 1
    }
  }
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * PENALTY_N4

  return result
}

/* ── public API ─────────────────────────────────────────────────────── */

export interface QrOptions {
  /** Error correction level. Defaults to `M`. */
  ecLevel?: QcEcLevel
  /** The smallest version to try. Defaults to 1. */
  minVersion?: number
  /** The largest version to try. Defaults to 40. */
  maxVersion?: number
}

/** Thrown when the payload does not fit into any QR code. */
export class QrPayloadTooLargeError extends Error {
  readonly neededBytes: number
  readonly maxBytes: number

  constructor(neededBytes: number, maxBytes: number) {
    super(`内容太长，放不进二维码（需要 ${neededBytes} 字节，最多 ${maxBytes} 字节）`)
    this.name = 'QrPayloadTooLargeError'
    this.neededBytes = neededBytes
    this.maxBytes = maxBytes
  }
}

/**
 * Encodes a string as a QR code.
 *
 * The smallest version that fits is used, so the resulting code stays easy to
 * scan.
 */
export function encodeQr(text: string, options: QrOptions = {}): QrCode {
  const ecLevel = options.ecLevel ?? 'M'
  const minVersion = Math.max(1, options.minVersion ?? 1)
  const maxVersion = Math.min(40, options.maxVersion ?? 40)
  const bytes = toUtf8Bytes(text)

  let version = minVersion
  while (version <= maxVersion && bytes.length > maxPayloadBytes(version, ecLevel)) {
    version += 1
  }
  if (version > maxVersion) {
    throw new QrPayloadTooLargeError(bytes.length, maxPayloadBytes(maxVersion, ecLevel))
  }

  const data = buildDataCodewords(bytes, version, ecLevel)
  const codewords = addEccAndInterleave(data, version, ecLevel)

  const size = version * 4 + 17
  const matrix = new Matrix(size)
  matrixSizeCache = size

  drawFunctionPatterns(matrix, version, ecLevel)
  drawCodewords(matrix, codewords)

  // Pick the mask with the lowest penalty score.
  let bestMask = 0
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(matrix, mask)
    drawFormatBits(matrix, ecLevel, mask)
    const penalty = penaltyScore(matrix)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
    }
    applyMask(matrix, mask) // undo
  }
  applyMask(matrix, bestMask)
  drawFormatBits(matrix, ecLevel, bestMask)

  return {
    modules: matrix.modules,
    size,
    version,
    ecLevel,
    isFunction: matrix.isFunction,
    mask: bestMask,
  }
}
