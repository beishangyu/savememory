import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, conceptsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { reviewCard } from '../fsrs/scheduler'
import { importWordList, parseWordList } from '../services/wordlist'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('解析词表', () => {
  it('识别减号分隔', () => {
    const result = parseWordList('apple - 苹果')
    expect(result.entries).toEqual([{ term: 'apple', definition: '苹果' }])
    expect(result.skipped).toHaveLength(0)
  })

  it('识别英文逗号与中文逗号', () => {
    expect(parseWordList('apple,苹果').entries).toEqual([
      { term: 'apple', definition: '苹果' },
    ])
    expect(parseWordList('apple，苹果').entries).toEqual([
      { term: 'apple', definition: '苹果' },
    ])
  })

  it('识别制表符分隔', () => {
    expect(parseWordList('apple\t苹果').entries).toEqual([
      { term: 'apple', definition: '苹果' },
    ])
  })

  it('识别冒号分隔', () => {
    expect(parseWordList('apple：苹果').entries).toEqual([
      { term: 'apple', definition: '苹果' },
    ])
    expect(parseWordList('apple: 苹果').entries).toEqual([
      { term: 'apple', definition: '苹果' },
    ])
  })

  it('释义里的逗号不会被误切', () => {
    // The dash is the strongest separator, so the comma inside the
    // definition stays where it is.
    const result = parseWordList('apple - 苹果，一种水果')
    expect(result.entries).toEqual([{ term: 'apple', definition: '苹果，一种水果' }])
  })

  it('连字符单词不会被当成分隔符', () => {
    const result = parseWordList('well-known - 众所周知的')
    expect(result.entries).toEqual([{ term: 'well-known', definition: '众所周知的' }])
  })

  it('忽略空行并统计无法识别的行', () => {
    const result = parseWordList('\napple - 苹果\n\n没有分隔符\n\n')
    expect(result.entries).toHaveLength(1)
    expect(result.skipped).toEqual(['没有分隔符'])
  })

  it('忽略重复词条并计数', () => {
    const result = parseWordList('apple - 苹果\napple - 苹果\nbanana - 香蕉')
    expect(result.entries).toHaveLength(2)
    expect(result.duplicates).toBe(1)
  })

  it('空文本解析出空结果', () => {
    const result = parseWordList('   \n  ')
    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })
})

describe('导入词表', () => {
  const settings = { ...DEFAULT_SETTINGS, apiKey: '' }

  it('单向下生成与词条数量相同的卡片', async () => {
    const parsed = parseWordList('apple - 苹果\nbanana - 香蕉')

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'apple - 苹果\nbanana - 香蕉',
    })

    expect(result.cards).toHaveLength(2)
    expect(result.concepts).toHaveLength(2)
    expect(result.cards.map((card) => card.prompt)).toEqual(['apple', 'banana'])
    expect(result.cards.map((card) => card.answer)).toEqual(['苹果', '香蕉'])
  })

  it('双向生成英→中与中→英两张卡', async () => {
    const parsed = parseWordList('apple - 苹果')

    const result = await importWordList(parsed.entries, {
      bidirectional: true,
      settings,
      rawText: 'apple - 苹果',
    })

    expect(result.cards).toHaveLength(2)
    const prompts = result.cards.map((card) => card.prompt).sort()
    expect(prompts).toEqual(['apple', '苹果'])
    expect(result.cards.every((card) => card.type === 'qa')).toBe(true)
  })

  it('写入 IndexedDB：来源、概念、卡片', async () => {
    const parsed = parseWordList('apple - 苹果')
    const result = await importWordList(parsed.entries, {
      bidirectional: true,
      settings,
      title: '四级词汇',
      rawText: 'apple - 苹果',
    })

    const source = await sourcesRepo.get(result.source.id)
    expect(source?.title).toBe('四级词汇')
    expect(source?.generationStatus).toBe('done')

    const concepts = await conceptsRepo.listBySource(result.source.id)
    expect(concepts).toHaveLength(1)
    expect(concepts[0].title).toBe('apple')

    const cards = await cardsRepo.listBySource(result.source.id)
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.conceptId === concepts[0].id)).toBe(true)
  })

  it('卡片带有 FSRS 初始状态，可以直接参与调度', async () => {
    const parsed = parseWordList('apple - 苹果')
    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'apple - 苹果',
    })

    const card = result.cards[0]
    expect(card.fsrsState).toBe(0)
    expect(card.fsrsScheduleStatus).toBe('new')
    expect(card.reps).toBe(0)
    expect(card.lapses).toBe(0)
    expect(card.lastReviewAt).toBeNull()
    // A brand new card has no stability/difficulty yet — exactly like the
    // model-generated ones, because both go through `createNewCard`.
    expect(card.fsrsStability).toBe(0)
    expect(card.fsrsDifficulty).toBe(0)
    expect(card.dueAt).toBeGreaterThan(0)

    // New cards are immediately due, so the study page can pick them up.
    expect(await cardsRepo.countDue(Date.now() + 60_000)).toBe(1)
  })

  it('生成的卡片可以直接被 FSRS 调度', async () => {
    const parsed = parseWordList('apple - 苹果')
    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'apple - 苹果',
    })

    const outcome = await reviewCard(
      { desiredRetention: settings.desiredRetention, maximumInterval: settings.maximumInterval },
      result.cards[0],
      'good',
    )

    expect(outcome.card.fsrsState).toBe(2) // Review
    expect(outcome.card.reps).toBe(1)
    expect(outcome.card.fsrsStability).toBeGreaterThan(0)
    expect(outcome.card.dueAt).toBeGreaterThan(Date.now())
  })

  it('没有 API Key 也能完成导入', async () => {
    const parsed = parseWordList('apple - 苹果')
    const result = await importWordList(parsed.entries, {
      bidirectional: true,
      settings: { ...settings, apiKey: '' },
      rawText: 'apple - 苹果',
    })

    expect(result.cards).toHaveLength(2)
    expect(await reviewLogsRepo.count()).toBe(0)
  })
})
