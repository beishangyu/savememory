import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, sourcesRepo } from '../db/repo'
import { BUILTIN_LISTS } from '../services/builtinLists'
import { importWordList, parseWordList } from '../services/wordlist'
import { DEFAULT_SETTINGS } from '../db/schema'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('内置词库', () => {
  it('有三份词表', () => {
    expect(BUILTIN_LISTS.map((list) => list.key)).toEqual(['cet4', 'cet6', 'kaoyan'])
  })

  it('每份词表都能读出来并且能解析', async () => {
    for (const list of BUILTIN_LISTS) {
      const text = await list.load()
      expect(text.length).toBeGreaterThan(1000)

      const parsed = parseWordList(text)
      expect(parsed.skipped).toEqual([])
      expect(parsed.duplicates).toBe(0)
      // 声明的词数要和实际一致。
      expect(parsed.entries).toHaveLength(list.count)
    }
  })

  it('词表里的每一行都是「单词 - 释义」', async () => {
    const list = BUILTIN_LISTS[0]
    const text = await list.load()
    const lines = text.split(/\r?\n/).filter((line) => line.trim())

    expect(lines).toHaveLength(BUILTIN_LISTS[0].count)
    for (const line of lines.slice(0, 50)) {
      expect(line).toMatch(/^[a-zA-Z][a-zA-Z'’-]* - .+/)
    }
  })

  it('导入后能生成卡片', async () => {
    const list = BUILTIN_LISTS[2]
    const text = await list.load()
    const parsed = parseWordList(text)

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      title: list.title,
      rawText: text,
    })

    expect(result.cards).toHaveLength(list.count)
    expect(result.concepts).toHaveLength(list.count)
    expect(await cardsRepo.count()).toBe(list.count)
    expect(await db.concepts.count()).toBe(list.count)
    expect((await sourcesRepo.list())[0].title).toBe(list.title)
  })

  it('生成双向卡片时数量翻倍', async () => {
    const list = BUILTIN_LISTS[0]
    const text = await list.load()
    const parsed = parseWordList(text)

    const result = await importWordList(parsed.entries, {
      bidirectional: true,
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      title: list.title,
      rawText: text,
    })

    expect(result.cards).toHaveLength(list.count * 2)
  })
})
