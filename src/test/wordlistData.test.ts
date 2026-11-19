import { describe, expect, it } from 'vitest'
import { parseWordList } from '../services/wordlist'
import cet4Text from '../../data/cet4.txt?raw'
import cet6Text from '../../data/cet6.txt?raw'
import kaoyanText from '../../data/kaoyan.txt?raw'

/**
 * The word lists in `data/` ship with the app and are pasted straight into
 * the 批量词表 importer, so they have to survive the real parser — not just
 * look right.
 */
const LISTS = [
  { name: 'cet4', text: cet4Text, min: 3000, max: 5000 },
  { name: 'cet6', text: cet6Text, min: 3000, max: 5000 },
  { name: 'kaoyan', text: kaoyanText, min: 3000, max: 5000 },
]

describe('词库文件', () => {
  for (const list of LISTS) {
    describe(list.name, () => {
      const lines = list.text.split(/\r?\n/).filter((line) => line.trim())
      const parsed = parseWordList(list.text)

      it('词条数量在预期范围内', () => {
        expect(lines.length).toBeGreaterThanOrEqual(list.min)
        expect(lines.length).toBeLessThanOrEqual(list.max)
      })

      it('每一行都能被解析器完整识别', () => {
        expect(parsed.skipped).toEqual([])
        expect(parsed.duplicates).toBe(0)
        expect(parsed.entries).toHaveLength(lines.length)
      })

      it('没有重复词条', () => {
        const words = parsed.entries.map((entry) => entry.term.toLowerCase())
        expect(new Set(words).size).toBe(words.length)
      })

      it('按字母顺序排列', () => {
        const sorted = [...lines].sort((a, b) => a.localeCompare(b, 'en'))
        expect(lines).toEqual(sorted)
      })

      it('释义里不含会被误判的分隔符', () => {
        for (const entry of parsed.entries) {
          // A comma or a colon would make the importer split the gloss.
          expect(entry.definition).not.toMatch(/[,，:：\t]/)
          // A spaced dash would be taken as the separator.
          expect(entry.definition).not.toMatch(/\s[-–—]\s/)
          expect(entry.definition.trim()).toBe(entry.definition)
          expect(entry.definition.length).toBeGreaterThan(0)
        }
      })

      it('词头是合法的英文单词', () => {
        for (const entry of parsed.entries) {
          expect(entry.term).toMatch(/^[a-zA-Z][a-zA-Z'’-]*$/)
        }
      })

      it('释义是中文', () => {
        for (const entry of parsed.entries) {
          expect(entry.definition).toMatch(/[一-鿿]/)
        }
      })
    })
  }
})
