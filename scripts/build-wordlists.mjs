/**
 * Build the vocabulary lists shipped in `data/`.
 *
 * Sources (all open source):
 *
 *   mahavivo/english-wordlists
 *     CET4_edited.txt              四级大纲词汇表（`词 [音标] 词性.释义`）
 *     CET6_edited.txt              六级词汇（同一格式）
 *     NPEE_Wordlist.txt            考研词汇（同一格式）
 *     COCA_20000.txt               COCA 词频序（越靠前越常用）
 *     柯林斯词频-5星至0星.xlsx       柯林斯星级词频（5★ 最常用）
 *   hehonghui/en_dict
 *     CET6_edited.txt              六级词汇（另一份来源，用于补全释义）
 *   KyleBing/english-vocabulary
 *     3 四级-乱序.txt / 4 六级-乱序.txt / 5 考研-乱序.txt    `词\t释义`
 *
 * Output: `data/cet4.txt`, `data/cet6.txt`, `data/kaoyan.txt` — one
 * `word - 释义` per line, alphabetically sorted, ready to paste into the
 * app's 批量词表 importer.
 *
 * Downloads are cached under `.cache/wordlists/`, so a re-run needs no
 * network at all.
 *
 * Usage: node scripts/build-wordlists.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const CACHE_DIR = '.cache/wordlists'
const USER_AGENT = 'savememory-build'

/** How many words to keep per list. */
const TARGET = { cet4: 4500, cet6: 4800, kaoyan: 5000 }

/** Definitions longer than this are truncated at a sense boundary. */
const MAX_DEF = 36

/* ────────────────────────────── fetching ────────────────────────────── */

/** Minimal tar reader — enough for a GitHub source tarball. */
function extractTar(buffer, wanted) {
  const files = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const sizeField = header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim()
    const size = sizeField ? parseInt(sizeField, 8) : 0
    const type = String.fromCharCode(header[156])
    const start = offset + 512
    if (type === '0' || type === '\0') {
      const simple = name.split('/').pop()
      if (wanted.includes(simple)) files.set(simple, buffer.subarray(start, start + size))
    }
    offset = start + Math.ceil(size / 512) * 512
  }
  return files
}

function cachePath(repo, path) {
  return `${CACHE_DIR}/${repo.replace('/', '__')}__${path.replace(/[\\/]/g, '__')}`
}

/** Reads a file from the local cache, if it was downloaded before. */
function readCache(repo, path) {
  const file = cachePath(repo, path)
  if (!existsSync(file)) return null
  return readFileSync(file)
}

function writeCache(repo, path, buffer) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cachePath(repo, path), buffer)
}

/**
 * Downloads the whole repository as a tarball and extracts the wanted files.
 * `codeload.github.com` is not subject to the REST API rate limit.
 */
async function fetchFromTarball(repo, paths) {
  const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/refs/heads/master`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`tarball ${repo} → ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const extracted = extractTar(buffer, paths)
  const result = new Map()
  for (const path of paths) {
    const data = extracted.get(path)
    if (!data) continue
    writeCache(repo, path, data)
    result.set(path, data)
  }
  return result
}

/** Downloads a single file through a raw-content proxy. */
async function fetchRaw(repo, path) {
  const url = `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/master/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`raw ${repo}/${path} → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Downloads a single file through the GitHub REST API. */
async function fetchViaApi(repo, path) {
  const url = `https://api.github.com/repos/${repo}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github.raw' },
  })
  if (!res.ok) throw new Error(`api ${repo}/${path} → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Resolves a list of files from one repository, trying the cheapest route
 * first: local cache → source tarball → raw proxy → REST API.
 */
async function fetchFiles(repo, paths) {
  const result = new Map()
  const missing = []

  for (const path of paths) {
    const cached = readCache(repo, path)
    if (cached) result.set(path, cached)
    else missing.push(path)
  }
  if (missing.length === 0) return result

  try {
    const tarball = await fetchFromTarball(repo, missing)
    for (const [path, data] of tarball) result.set(path, data)
  } catch {
    // The tarball route is not always available (huge repositories, proxies).
  }

  for (const path of missing) {
    if (result.has(path)) continue
    let data = null
    try {
      data = await fetchRaw(repo, path)
    } catch {
      data = await fetchViaApi(repo, path)
    }
    writeCache(repo, path, data)
    result.set(path, data)
  }
  return result
}

const asText = (buffer) => buffer.toString('utf8')

/* ─────────────────────────── minimal xlsx reader ─────────────────────── */

/** Reads the entries of an xlsx without any dependency. */
function readXlsx(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')

  const entries = new Map()
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.set(name, { method, compressedSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }

  const read = (name) => {
    const entry = entries.get(name)
    if (!entry) return null
    const local = entry.localOffset
    const nameLen = buffer.readUInt16LE(local + 26)
    const extraLen = buffer.readUInt16LE(local + 28)
    const start = local + 30 + nameLen + extraLen
    const raw = buffer.subarray(start, start + entry.compressedSize)
    return entry.method === 0 ? raw : inflateRawSync(raw)
  }

  return { names: [...entries.keys()], read }
}

const decodeXml = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')

function readSharedStrings(xml) {
  const list = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let match
  while ((match = re.exec(xml))) {
    const parts = []
    const textRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let textMatch
    while ((textMatch = textRe.exec(match[1]))) parts.push(textMatch[1])
    list.push(decodeXml(parts.join('')))
  }
  return list
}

/** Reads every cell of a worksheet into a list of row maps. */
function readSheetRows(xml, shared) {
  const rows = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  const cellRe = /<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = new Map()
    let cellMatch
    cellRe.lastIndex = 0
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const column = cellMatch[1]
      const attributes = cellMatch[2]
      const body = cellMatch[3]
      const inlineMatch = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body)
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
      let value = ''
      if (inlineMatch) value = decodeXml(inlineMatch[1])
      else if (valueMatch) {
        value = decodeXml(valueMatch[1])
        if (/t="s"/.test(attributes)) value = shared[Number(value)] ?? ''
      }
      cells.set(column, value)
    }
    rows.push(cells)
  }
  return rows
}

/**
 * Reads the Collins star workbook into `word -> star` (0..5).
 * Each worksheet holds the words of one star band.
 */
function readCollinsStars(buffer) {
  const zip = readXlsx(buffer)

  const sharedXml = zip.read('xl/sharedStrings.xml')
  const shared = sharedXml ? readSharedStrings(sharedXml.toString('utf8')) : []

  const relsXml = zip.read('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const rels = new Map()
  const relRe = /Id="([^"]+)"[^>]*Target="([^"]+)"/g
  let relMatch
  while ((relMatch = relRe.exec(relsXml))) {
    rels.set(relMatch[1], relMatch[2].replace(/^\/?xl\//, '').replace(/^\//, ''))
  }

  const workbookXml = zip.read('xl/workbook.xml')?.toString('utf8') ?? ''
  const sheetRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g
  const stars = new Map()
  let sheetMatch
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    const name = decodeXml(sheetMatch[1])
    const target = rels.get(sheetMatch[2])
    const starMatch = /(\d)/.exec(name)
    if (!starMatch || !target) continue
    const sheetXml = zip.read(`xl/${target}`)?.toString('utf8')
    if (!sheetXml) continue
    const star = Number(starMatch[1])
    for (const row of readSheetRows(sheetXml, shared)) {
      const word = (row.get('A') ?? '').trim()
      if (word) stars.set(word.toLowerCase(), star)
    }
  }
  return stars
}

/* ───────────────────────────── cleaning ─────────────────────────────── */

const POS_TAGS = [
  'n', 'v', 'vt', 'vi', 'adj', 'adv', 'ad', 'a', 'prep', 'conj', 'pron', 'num',
  'art', 'aux', 'int', 'interj', 'abbr', 'pl', 'sg', 'det', 'mod', 'comb', 'link',
  'vbl', 'auxv', 'sb', 'sing', 'plur',
]
const POS_ALTERNATION = POS_TAGS.join('|')
/** A part-of-speech marker such as `n.` or `vt.`. */
const POS_RE = new RegExp(`^(?:[/&]?\\s*(?:${POS_ALTERNATION})\\.\\s*)+`, 'i')
/** A part-of-speech marker in the middle of a definition. */
const POS_INLINE_RE = new RegExp(
  `(?<![A-Za-z])\\s*[.、]?\\s*(?:${POS_ALTERNATION})\\.(?=\\s|[\\u4e00-\\u9fff])`,
  'gi',
)
/** A leading "1." sense number. */
const NUMBERED_SENSE_RE = /^\d{1,2}\s*[.、)）]\s*/

/**
 * Turns a raw definition into a clean, comma-free, dash-free Chinese gloss.
 *
 * The result is a list of senses joined with `；`, which keeps the card
 * readable and — importantly — free of the characters the app's importer
 * would otherwise treat as separators.
 */
function cleanDefinition(raw) {
  let text = raw

  // Markup and phonetics.
  text = text.replace(/<[^>]{0,200}>/g, ' ')
  text = text.replace(/\[[^\]]{0,60}\]/g, ' ')
  text = text.replace(/\/[^/]{0,60}\//g, ' ')
  // Some sources write the phonetic without brackets ("arbitrary ˈɑːbɪtrərɪ /adj. ...").
  text = text.replace(/^[^一-鿿/]{0,30}\//, ' ')
  // Some sources write `adv::当然` instead of `adv. 当然`.
  text = text.replace(/::/g, '. ')
  // Some sources label the field explicitly ("3、释义:n. ...").
  text = text.replace(/(?:中文)?(?:释义|词义|意思)\s*[:：]\s*/g, ' ')

  // Leading part of speech and sense number.
  text = text.replace(POS_RE, '')
  text = text.replace(NUMBERED_SENSE_RE, '')

  // Keep the first numbered sense only.
  text = text.split(/\s+\d{1,2}\s*[.、)）]\s*/)[0]

  // Asides are dropped when they are a grammatical label ("(to,for)") or when
  // they are too long ("有能力(时间、知识等)做某事"). Short ones only lose
  // their brackets ("一(个)" -> "一个").
  text = text.replace(/[（(]([^）)]{0,40})[）)]/g, (whole, inner) => {
    const hasChinese = /[\u4e00-\u9fff]/.test(inner)
    if (!hasChinese || inner.length > 6) return ' '
    return inner
  })

  // Split into individual senses.
  const parts = text
    .split(/[；;]/)
    .flatMap((part) => part.split(POS_INLINE_RE))
    .flatMap((part) => part.split(/[、,，]/))

  const cleaned = []
  const seen = new Set()
  for (const part of parts) {
    let sense = part.replace(/\s+/g, ' ').trim()
    // Stray punctuation in front of the part of speech ("掠过 .n.擦伤处").
    sense = sense.replace(/^[.、,，;；:：&\s]+/, '').trim()
    // A sense may start with its own part-of-speech marker.
    sense = sense.replace(POS_RE, '')
    sense = sense.replace(NUMBERED_SENSE_RE, '')
    // Dashes inside a gloss are noise for a flashcard.
    sense = sense.replace(/\s*[-–—]+\s*/g, ' ')
    sense = sense.replace(/\s+/g, ' ').trim()
    sense = sense.replace(/^[&.;:：、\s]+/, '').trim()
    if (!sense) continue
    // "中文释义" is a placeholder some sources use for an empty gloss.
    if (sense === '中文释义' || sense === '释义') continue
    const key = sense.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(sense)
  }

  let result = cleaned.join('；')

  // Trim over-long glosses at a sense boundary.
  if (result.length > MAX_DEF) {
    const head = result.slice(0, MAX_DEF)
    const cut = head.lastIndexOf('；')
    result = (cut > MAX_DEF * 0.5 ? head.slice(0, cut) : head).trim()
  }
  return result
}

/** Keeps only plausible English headwords. */
function isValidWord(word) {
  if (!word || word.length > 25) return false
  if (!/^[A-Za-z]/.test(word)) return false
  if (!/^[A-Za-z][A-Za-z'’\- ]*$/.test(word)) return false
  return true
}

/** A gloss is only usable when it actually says something in Chinese. */
function isUsableDefinition(definition) {
  return Boolean(definition) && /[一-鿿]/.test(definition)
}

/** Parses `word [phonetic] pos. definition` lines. */
function parseOutline(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^([A-Za-z][A-Za-z'’\-]*)\s*(?:\[[^\]]{0,60}\])?\s*(.*)$/.exec(trimmed)
    if (!match) continue
    const word = match[1].trim()
    if (!isValidWord(word)) continue
    const definition = cleanDefinition(match[2])
    if (!isUsableDefinition(definition)) continue
    const key = word.toLowerCase()
    if (!map.has(key)) map.set(key, definition)
  }
  return map
}

/** Parses `word\tdefinition` lines. */
function parseTabbed(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const word = line.slice(0, tab).trim()
    if (!isValidWord(word)) continue
    const definition = cleanDefinition(line.slice(tab + 1))
    if (!isUsableDefinition(definition)) continue
    const key = word.toLowerCase()
    if (!map.has(key)) map.set(key, definition)
  }
  return map
}

/* ──────────────────────────── assembling ────────────────────────────── */

function mergeDefinitions(primary, secondary) {
  const merged = new Map(primary)
  for (const [word, definition] of secondary) {
    if (!merged.has(word)) merged.set(word, definition)
  }
  return merged
}

/**
 * Picks the `count` most useful words.
 *
 * Ranking: Collins star band first (5★ = everyday core), then COCA
 * frequency. Words neither source knows go last.
 */
function selectCore(words, { stars, cocaRank }, count) {
  const scored = []
  for (const word of words.keys()) {
    const star = stars.get(word) ?? -1
    const rank = cocaRank.get(word) ?? Number.MAX_SAFE_INTEGER
    scored.push({ word, star, rank })
  }
  scored.sort((a, b) => b.star - a.star || a.rank - b.rank || a.word.localeCompare(b.word))
  return scored.slice(0, count)
}

function writeList(name, definitions, chosen) {
  const lines = chosen
    .map((item) => `${item.word} - ${definitions.get(item.word)}`)
    .sort((a, b) => a.localeCompare(b, 'en'))
  writeFileSync(`data/${name}.txt`, `${lines.join('\n')}\n`, 'utf8')
  const stars = chosen.reduce((acc, item) => {
    acc[item.star] = (acc[item.star] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `data/${name}.txt: ${lines.length} 词（柯林斯星级分布 ${JSON.stringify(stars)}）`,
  )
  return lines
}

/* ─────────────────────────────── main ───────────────────────────────── */

console.log('下载词库…')
const mahavivo = await fetchFiles('mahavivo/english-wordlists', [
  'CET4_edited.txt',
  'CET6_edited.txt',
  'NPEE_Wordlist.txt',
  'COCA_20000.txt',
  '柯林斯词频-5星至0星.xlsx',
])
const enDict = await fetchFiles('hehonghui/en_dict', ['CET6_edited.txt'])
const kyleBing = await fetchFiles('KyleBing/english-vocabulary', [
  '3 四级-乱序.txt',
  '4 六级-乱序.txt',
  '5 考研-乱序.txt',
])

const stars = readCollinsStars(mahavivo.get('柯林斯词频-5星至0星.xlsx'))

const cocaRank = new Map()
asText(mahavivo.get('COCA_20000.txt'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .forEach((word, index) => {
    const key = word.toLowerCase()
    if (!cocaRank.has(key)) cocaRank.set(key, index)
  })

const cet4Outline = parseOutline(asText(mahavivo.get('CET4_edited.txt')))
const cet4Tabbed = parseTabbed(asText(kyleBing.get('3 四级-乱序.txt')))
const cet6Outline = mergeDefinitions(
  parseOutline(asText(mahavivo.get('CET6_edited.txt'))),
  parseOutline(asText(enDict.get('CET6_edited.txt'))),
)
const cet6Tabbed = parseTabbed(asText(kyleBing.get('4 六级-乱序.txt')))
const kaoyanOutline = parseOutline(asText(mahavivo.get('NPEE_Wordlist.txt')))
const kaoyanTabbed = parseTabbed(asText(kyleBing.get('5 考研-乱序.txt')))

console.log(
  `源词数：四级 ${cet4Outline.size}+${cet4Tabbed.size}，六级 ${cet6Outline.size}+${cet6Tabbed.size}，考研 ${kaoyanOutline.size}+${kaoyanTabbed.size}`,
)
console.log(`柯林斯词频 ${stars.size} 词；COCA ${cocaRank.size} 词`)

const frequency = { stars, cocaRank }

const cet4All = mergeDefinitions(cet4Outline, cet4Tabbed)
const cet6All = mergeDefinitions(cet6Outline, cet6Tabbed)
const kaoyanAll = mergeDefinitions(kaoyanOutline, kaoyanTabbed)

mkdirSync('data', { recursive: true })

writeList('cet4', cet4All, selectCore(cet4All, frequency, TARGET.cet4))
writeList('cet6', cet6All, selectCore(cet6All, frequency, TARGET.cet6))
writeList('kaoyan', kaoyanAll, selectCore(kaoyanAll, frequency, TARGET.kaoyan))
