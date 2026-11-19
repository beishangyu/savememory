import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import {
  answerIsBlankContent,
  clozeBlanks,
  hasCloze,
  maskCloze,
  splitCloze,
  stripCloze,
} from '../lib/cloze'
import { importWordList, parseWordList } from '../services/wordlist'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('填空题标记解析', () => {
  it('识别方括号写法', () => {
    const segments = splitCloze('I [go] to school every day.')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: 'text', content: 'I ' })
    expect(segments[1]).toEqual({ type: 'blank', content: 'go', ordinal: undefined })
    expect(segments[2]).toEqual({ type: 'text', content: ' to school every day.' })
  })

  it('识别带序号的写法', () => {
    const segments = splitCloze('The {{c1::capital}} of France is Paris.')
    const blank = segments.find((segment) => segment.type === 'blank')
    expect(blank).toEqual({ type: 'blank', content: 'capital', ordinal: 1 })
  })

  it('识别不带序号的写法', () => {
    const segments = splitCloze('复习间隔越 {{短}} 越好。')
    const blank = segments.find((segment) => segment.type === 'blank')
    expect(blank).toEqual({ type: 'blank', content: '短', ordinal: undefined })
  })

  it('识别多个空缺', () => {
    const blanks = clozeBlanks('I [go] to [school] every day.')
    expect(blanks).toEqual(['go', 'school'])
  })

  it('空括号不算空缺', () => {
    expect(hasCloze('nothing here []')).toBe(false)
    expect(hasCloze('nothing here {{}}')).toBe(false)
    expect(hasCloze('no markers at all')).toBe(false)
  })

  it('遮罩后用 [...] 代替空缺', () => {
    expect(maskCloze('I [go] to school every day.')).toBe('I [...] to school every day.')
    expect(maskCloze('The {{c1::capital}} of France')).toBe('The [...] of France')
  })

  it('去掉标记但保留内容', () => {
    expect(stripCloze('I [go] to school every day.')).toBe('I go to school every day.')
    expect(stripCloze('The {{c1::capital}} of France')).toBe('The capital of France')
  })
})

describe('答案与空缺内容的区分', () => {
  it('答案就是空缺内容本身', () => {
    expect(answerIsBlankContent('复习间隔越 {{短}} 越好。', '短')).toBe(true)
  })

  it('答案是整句翻译', () => {
    expect(answerIsBlankContent('I [go] to school.', '我每天去上学。')).toBe(false)
  })

  it('没有空缺时一律为否', () => {
    expect(answerIsBlankContent('plain question', 'answer')).toBe(false)
  })
})

describe('词表导入识别填空题', () => {
  const settings = { ...DEFAULT_SETTINGS, apiKey: '' }

  it('方括号写法能被正确切分', () => {
    const result = parseWordList('I [go] to school every day. - 我每天去上学。')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].term).toBe('I [go] to school every day.')
    expect(result.entries[0].definition).toBe('我每天去上学。')
  })

  it('带序号的写法能被正确切分', () => {
    const result = parseWordList('The {{c1::capital}} of France is Paris. - 法国首都是巴黎。')
    expect(result.entries[0].term).toBe('The {{c1::capital}} of France is Paris.')
    expect(result.entries[0].definition).toBe('法国首都是巴黎。')
  })

  it('含空缺的一行生成填空题', async () => {
    const parsed = parseWordList('I [go] to school every day. - 我每天去上学。')

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'I [go] to school every day. - 我每天去上学。',
    })

    expect(result.cards).toHaveLength(1)
    const card = result.cards[0]
    expect(card.type).toBe('cloze')
    // 题面保留用户写的标记，答案是整句翻译。
    expect(card.prompt).toBe('I [go] to school every day.')
    expect(card.answer).toBe('我每天去上学。')
  })

  it('不含空缺的一行仍然是问答', async () => {
    const parsed = parseWordList('apple - 苹果')

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'apple - 苹果',
    })

    expect(result.cards[0].type).toBe('qa')
    expect(result.cards[0].prompt).toBe('apple')
    expect(result.cards[0].answer).toBe('苹果')
  })

  it('填空题与双向卡片共存', async () => {
    const parsed = parseWordList('I [go] to school every day. - 我每天去上学。')

    const result = await importWordList(parsed.entries, {
      bidirectional: true,
      settings,
      rawText: 'I [go] to school every day. - 我每天去上学。',
    })

    expect(result.cards).toHaveLength(2)

    const cloze = result.cards.find((card) => card.type === 'cloze')
    const reverse = result.cards.find((card) => card.type === 'qa')
    expect(cloze?.prompt).toBe('I [go] to school every day.')
    expect(cloze?.answer).toBe('我每天去上学。')
    // 反向卡问的是整句翻译，答案里没有标记。
    expect(reverse?.prompt).toBe('我每天去上学。')
    expect(reverse?.answer).toBe('I go to school every day.')
  })

  it('概念标题用去掉标记的句子', async () => {
    const parsed = parseWordList('I [go] to school every day. - 我每天去上学。')

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: 'I [go] to school every day. - 我每天去上学。',
    })

    expect(result.concepts[0].title).toBe('I go to school every day.')
  })

  it('两种写法可以混在一张词表里', async () => {
    const raw = 'apple - 苹果\nI [go] to school every day. - 我每天去上学。'
    const parsed = parseWordList(raw)

    const result = await importWordList(parsed.entries, {
      bidirectional: false,
      settings,
      rawText: raw,
    })

    expect(result.cards).toHaveLength(2)
    expect(result.cards.filter((card) => card.type === 'cloze')).toHaveLength(1)
    expect(result.cards.filter((card) => card.type === 'qa')).toHaveLength(1)
    expect(result.clozeCount).toBe(1)
    expect(await cardsRepo.count()).toBe(2)
  })
})
