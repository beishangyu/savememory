import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, conceptsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Settings } from '../db/schema'
import { reviewCard } from '../fsrs/scheduler'
import { extractConcepts, generateQuestions } from '../llm/generate'
import { createTextSource, generateForSource } from '../services/ingest'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { BrokenProvider, FakeProvider } from './fakeProvider'

const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' }
const schedulerOptions = {
  desiredRetention: settings.desiredRetention,
  maximumInterval: settings.maximumInterval,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings, loaded: true })
  useStudy.getState().reset()
})

describe('概念切分', () => {
  it('把材料切分为原子概念', async () => {
    const provider = new FakeProvider()
    const concepts = await extractConcepts(provider, '一段关于 TCP 与进程的材料。')
    expect(concepts).toHaveLength(3)
    expect(concepts[0].title).toBe('三次握手')
    expect(concepts[0].tags).toEqual(['网络'])
  })

  it('模型输出不是 JSON 时重试，最终抛出可读错误', async () => {
    const provider = new BrokenProvider()
    await expect(extractConcepts(provider, '任意材料')).rejects.toThrow(/校验失败/)
    // 1 次首发 + 2 次重试
    expect(provider.attempts).toBe(3)
  })
})

describe('出题与难度配比', () => {
  it('难度按 30% / 50% / 20% 配比', async () => {
    const provider = new FakeProvider({ allQuestionsMedium: true })
    const concepts = await extractConcepts(provider, '材料')
    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 2,
      formats: ['qa', 'cloze'],
    })

    // 3 概念 × 2 题 = 6 题 → 简单 2 / 中等 3 / 困难 1
    expect(questions).toHaveLength(6)

    const counts = { easy: 0, medium: 0, hard: 0 }
    for (const question of questions) counts[question.difficulty] += 1
    expect(counts).toEqual({ easy: 2, medium: 3, hard: 1 })
  })

  it('每个概念至少生成 1 道题', async () => {
    const provider = new FakeProvider()
    const concepts = await extractConcepts(provider, '材料')
    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 1,
      formats: ['qa', 'cloze'],
    })

    const perConcept = new Map<number, number>()
    for (const question of questions) {
      perConcept.set(question.conceptIndex, (perConcept.get(question.conceptIndex) ?? 0) + 1)
    }
    expect(perConcept.size).toBe(concepts.length)
    for (const count of perConcept.values()) expect(count).toBeGreaterThanOrEqual(1)
  })

  it('题干与答案都非空', async () => {
    const provider = new FakeProvider()
    const concepts = await extractConcepts(provider, '材料')
    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 2,
      formats: ['qa', 'cloze'],
    })
    for (const question of questions) {
      expect(question.prompt.length).toBeGreaterThan(0)
      expect(question.answer.length).toBeGreaterThan(0)
    }
  })
})

describe('端到端：材料 → 卡片 → 学习', () => {
  it('生成的卡片写入本地数据库且立即到期', async () => {
    const source = await createTextSource('TCP 建立连接需要三次握手。', '测试材料')
    const result = await generateForSource(source.id, settings, new FakeProvider())

    expect(result.concepts).toHaveLength(3)
    expect(result.cards).toHaveLength(6)

    const stored = await cardsRepo.listBySource(source.id)
    expect(stored).toHaveLength(6)

    const due = await cardsRepo.listDue(Date.now())
    expect(due).toHaveLength(6)

    const concepts = await conceptsRepo.listBySource(source.id)
    expect(concepts).toHaveLength(3)
  })

  it('刷新后（重新从数据库读取）依然能继续调度', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())

    const card = (await cardsRepo.listDue(Date.now()))[0]
    const outcome = await reviewCard(schedulerOptions, card, 'good')

    await cardsRepo.put(outcome.card)
    await reviewLogsRepo.put({
      id: 'log-1',
      cardId: card.id,
      conceptId: card.conceptId,
      rating: outcome.revlog.rating,
      reviewedAt: Date.now(),
      dueAt: outcome.revlog.dueAt.getTime(),
      state: outcome.revlog.state,
      elapsedDays: 0,
      scheduledDays: outcome.revlog.scheduledDays,
      durationMs: 1234,
      mode: 'self',
    })

    // 模拟刷新页面：从 IndexedDB 读出来的卡片日期是字符串，必须能被再次调度
    const reloaded = await cardsRepo.get(card.id)
    expect(reloaded).toBeDefined()
    expect(typeof reloaded!.dueAt).toBe('number')

    const second = await reviewCard(schedulerOptions, reloaded!, 'good')
    expect(second.card.dueAt).toBeGreaterThan(Date.now())
    expect(second.card.reps).toBe(2)
  })

  it('评分后 FSRS 会安排下一次复习时间', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const card = (await cardsRepo.listDue(Date.now()))[0]

    const good = await reviewCard(schedulerOptions, card, 'good')
    expect(good.card.dueAt).toBeGreaterThan(Date.now())
    expect(good.card.reps).toBe(1)

    const again = await reviewCard(schedulerOptions, card, 'again')
    // 重来会进入学习阶段，几分钟后再次到期
    expect(again.card.dueAt).toBeGreaterThan(Date.now())
    expect(again.card.dueAt).toBeLessThan(Date.now() + 60 * 60 * 1000)
  })
})

describe('学习会话', () => {
  it('答错（重来）的卡片会排到会话末尾再次出现', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    expect(useStudy.getState().queue).toHaveLength(6)

    await useStudy.getState().submit('again')

    // 队列变长：原 6 张 + 重新排队的 1 张
    expect(useStudy.getState().queue).toHaveLength(7)
    // 答错后先问「为什么没记住」，不直接跳到下一张
    expect(useStudy.getState().attribution).toBeTruthy()
    expect(useStudy.getState().index).toBe(0)
    // 答错的卡片仍然要经历「先回忆再看答案」，所以 revealed 复位为 false
    expect(useStudy.getState().revealed).toBe(false)

    // 归因之后才进入下一张
    await useStudy.getState().attributeCause('forgotten')
    expect(useStudy.getState().index).toBe(1)
    expect(useStudy.getState().attribution).toBeNull()
  })

  it('答对后卡片不再出现在本次会话队列中', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    await useStudy.getState().submit('good')

    expect(useStudy.getState().queue).toHaveLength(6)
    expect(useStudy.getState().index).toBe(1)
    expect(useStudy.getState().results).toHaveLength(1)
    expect(useStudy.getState().results[0].grade).toBe('good')
  })

  it('复习记录会写入数据库', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    await useStudy.getState().submit('good')

    const logs = await reviewLogsRepo.listRecent(10)
    expect(logs).toHaveLength(1)
    expect(logs[0].rating).toBe(3)
  })
})

describe('来源管理', () => {
  it('删除来源会连带删除概念、卡片与复习记录', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const firstCard = (await cardsRepo.listBySource(source.id))[0]
    await reviewLogsRepo.put({
      id: 'log-x',
      cardId: firstCard.id,
      conceptId: 'x',
      rating: 3,
      reviewedAt: Date.now(),
      dueAt: Date.now(),
      state: 2,
      elapsedDays: 0,
      scheduledDays: 1,
      durationMs: 10,
      mode: 'self',
    })

    await sourcesRepo.remove(source.id)

    expect(await sourcesRepo.list()).toHaveLength(0)
    expect(await conceptsRepo.listBySource(source.id)).toHaveLength(0)
    expect(await cardsRepo.listBySource(source.id)).toHaveLength(0)
    expect(await reviewLogsRepo.count()).toBe(0)
  })
})
