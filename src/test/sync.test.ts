import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, conceptsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import { createNewCard } from '../fsrs/scheduler'
import { uid } from '../lib/id'
import {
  applyBundle,
  buildSyncPayload,
  collectBundle,
  extractPayload,
  parseBundle,
  serializeBundle,
  SYNC_PREFIX_COMPRESSED,
} from '../services/sync'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seedLibrary() {
  const source = {
    id: uid('src'),
    kind: 'text' as const,
    title: '词表',
    text: 'apple - 苹果',
    createdAt: Date.now(),
    generationStatus: 'done' as const,
  }
  await sourcesRepo.put(source)

  const concept = {
    id: uid('con'),
    sourceId: source.id,
    index: 0,
    title: 'apple',
    statement: 'apple',
    tags: [],
    createdAt: Date.now(),
  }
  await conceptsRepo.bulkPut([concept])

  const card = await createNewCard(
    { desiredRetention: 0.9, maximumInterval: 36500 },
    uid('card'),
  )
  card.conceptId = concept.id
  card.sourceId = source.id
  card.prompt = 'apple'
  card.answer = '苹果'
  await cardsRepo.put(card)

  await reviewLogsRepo.put({
    id: uid('log'),
    cardId: card.id,
    conceptId: concept.id,
    rating: 3,
    reviewedAt: Date.now(),
    dueAt: Date.now() + 86_400_000,
    state: 2,
    elapsedDays: 0,
    scheduledDays: 1,
    durationMs: 500,
    mode: 'self' as const,
  })

  return { source, concept, card }
}

describe('同步数据', () => {
  it('收集词库、卡片和复习记录', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')

    expect(bundle.sources).toHaveLength(1)
    expect(bundle.concepts).toHaveLength(1)
    expect(bundle.cards).toHaveLength(1)
    expect(bundle.reviewLogs).toHaveLength(1)
    expect(bundle.tier).toBe('full')
  })

  it('cards 档不包含复习记录', async () => {
    await seedLibrary()
    const bundle = await collectBundle('cards')

    expect(bundle.cards).toHaveLength(1)
    expect(bundle.reviewLogs).toHaveLength(0)
    expect(bundle.tier).toBe('cards')
  })

  it('不包含图片', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')
    expect(bundle.sources[0]).not.toHaveProperty('image')
  })

  it('序列化后可以原样解析回来', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')
    const text = await serializeBundle(bundle)

    expect(text.startsWith(SYNC_PREFIX_COMPRESSED)).toBe(true)

    const parsed = await parseBundle(text)
    expect(parsed.cards).toHaveLength(1)
    expect(parsed.cards[0].prompt).toBe('apple')
    expect(parsed.reviewLogs).toHaveLength(1)
    expect(parsed.concepts).toHaveLength(1)
  })

  it('压缩让数据小很多', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')
    const text = await serializeBundle(bundle)
    const raw = JSON.stringify(bundle)
    expect(text.length).toBeLessThan(raw.length)
  })

  it('能从链接里取出数据', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')
    const text = await serializeBundle(bundle)

    const link = `https://example.com/app/#sync=${text}`
    expect(extractPayload(link)).toBe(text)
    expect(extractPayload(text)).toBe(text)
    expect(extractPayload('随便什么')).toBe('')

    const parsed = await parseBundle(link)
    expect(parsed.cards).toHaveLength(1)
  })

  it('不是同步数据时给出可读错误', async () => {
    await expect(parseBundle('随便什么')).rejects.toThrow(/不像是同步数据/)
    await expect(parseBundle('SM1:不是有效的base64!!')).rejects.toThrow()
  })
})

describe('合并同步数据', () => {
  it('把没有的记录加进来', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')

    // 清空本地，模拟另一台设备。
    await db.sources.clear()
    await db.concepts.clear()
    await db.cards.clear()
    await db.reviewLogs.clear()

    const result = await applyBundle(bundle)

    expect(result.sources).toBe(1)
    expect(result.concepts).toBe(1)
    expect(result.cards).toBe(1)
    expect(result.reviewLogs).toBe(1)
    expect(await cardsRepo.count()).toBe(1)
  })

  it('已有的卡片取复习次数更多的那一份', async () => {
    const { card } = await seedLibrary()
    const bundle = await collectBundle('full')

    // 本地那张卡复习得更多。
    await cardsRepo.put({ ...card, reps: 5, fsrsStability: 12 })

    const result = await applyBundle(bundle)

    expect(result.updated).toBe(0)
    const local = await cardsRepo.get(card.id)
    expect(local?.reps).toBe(5)
  })

  it('远端进度更多时更新本地卡片', async () => {
    const { card } = await seedLibrary()
    const bundle = await collectBundle('full')
    bundle.cards[0] = { ...bundle.cards[0], reps: 9, fsrsStability: 20 }

    const result = await applyBundle(bundle)

    expect(result.updated).toBe(1)
    const local = await cardsRepo.get(card.id)
    expect(local?.reps).toBe(9)
  })

  it('不会删除本机独有的内容', async () => {
    await seedLibrary()
    const bundle = await collectBundle('full')

    const own = await createNewCard(
      { desiredRetention: 0.9, maximumInterval: 36500 },
      uid('card'),
    )
    own.prompt = 'banana'
    own.answer = '香蕉'
    await cardsRepo.put(own)

    await applyBundle(bundle)

    expect(await cardsRepo.count()).toBe(2)
  })
})

describe('同步负载', () => {
  it('小数据用完整档', async () => {
    await seedLibrary()
    const payload = await buildSyncPayload()

    expect(payload.tier).toBe('full')
    expect(payload.size).toBeLessThanOrEqual(2953)
    expect(payload.counts.reviewLogs).toBe(1)
  })

  it('数据太大时退回到只同步卡片', async () => {
    // 造一堆复习记录，把完整档撑爆。
    await seedLibrary()
    for (let index = 0; index < 400; index += 1) {
      await reviewLogsRepo.put({
        id: uid('log'),
        cardId: 'card-x',
        conceptId: 'con-x',
        rating: 3,
        reviewedAt: Date.now(),
        dueAt: Date.now(),
        state: 2,
        elapsedDays: 0,
        scheduledDays: 1,
        durationMs: 100,
        mode: 'self',
      })
    }

    const payload = await buildSyncPayload()
    expect(payload.tier).toBe('cards')
    expect(payload.counts.reviewLogs).toBe(0)
    expect(payload.size).toBeLessThanOrEqual(2953)
  })

  it('连卡片都装不下时给出提示', async () => {
    // 一份无法压缩的随机词库。
    let noise = ''
    let seed = 12345
    for (let index = 0; index < 20_000; index += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      noise += String.fromCharCode(33 + (seed % 90))
    }
    const source = {
      id: uid('src'),
      kind: 'text' as const,
      title: '超大词表',
      text: noise,
      createdAt: Date.now(),
      generationStatus: 'done' as const,
    }
    await sourcesRepo.put(source)

    await expect(buildSyncPayload()).rejects.toThrow(/WebDAV/)
  })
})
