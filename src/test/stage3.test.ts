// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Card, type Settings } from '../db/schema'
import { buildQuestionPlan, generateQuestions } from '../llm/generate'
import { updateAppBadge } from '../services/reminder'
import { buildSessionQueue, countTopics } from '../services/session'
import { createTextSource, generateForSource } from '../services/ingest'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { FakeProvider } from './fakeProvider'

const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' }

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: 'card',
    conceptId: 'concept',
    sourceId: 'source',
    type: 'qa',
    prompt: '题目',
    answer: '答案',
    questionDifficulty: 'medium',
    fsrsStability: 0,
    fsrsStabilityFast: 0,
    fsrsDifficulty: 0,
    fsrsState: 0,
    fsrsScheduleStatus: 'new',
    dueAt: 0,
    lastReviewAt: null,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    learningStep: 0,
    createdAt: 0,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings, loaded: true })
  useStudy.getState().reset()
})

describe('交错练习', () => {
  it('同一会话里混合不同主题的卡片', () => {
    const cards = [
      makeCard({ id: 'a1', sourceId: 's1', conceptId: 'c1', dueAt: 1 }),
      makeCard({ id: 'a2', sourceId: 's1', conceptId: 'c1', dueAt: 2 }),
      makeCard({ id: 'a3', sourceId: 's1', conceptId: 'c1', dueAt: 3 }),
      makeCard({ id: 'b1', sourceId: 's2', conceptId: 'c2', dueAt: 4 }),
      makeCard({ id: 'b2', sourceId: 's2', conceptId: 'c2', dueAt: 5 }),
    ]

    const queue = buildSessionQueue(cards, 'interleave')

    // 所有卡片都还在，顺序被重排
    expect(queue).toHaveLength(cards.length)
    expect(new Set(queue.map((card) => card.id)).size).toBe(cards.length)

    // 前两张来自不同主题
    expect(queue[0].sourceId).not.toBe(queue[1].sourceId)
    expect(countTopics(queue)).toBe(2)

    // 同一个主题的卡片不会连着出现
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i].sourceId).not.toBe(queue[i - 1].sourceId)
    }
  })

  it('同一主题下的不同概念也会交叉', () => {
    const cards = [
      makeCard({ id: 'a1', sourceId: 's1', conceptId: 'c1', dueAt: 1 }),
      makeCard({ id: 'a2', sourceId: 's1', conceptId: 'c2', dueAt: 2 }),
      makeCard({ id: 'a3', sourceId: 's1', conceptId: 'c1', dueAt: 3 }),
      makeCard({ id: 'a4', sourceId: 's1', conceptId: 'c2', dueAt: 4 }),
    ]

    const queue = buildSessionQueue(cards, 'interleave')
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i].conceptId).not.toBe(queue[i - 1].conceptId)
    }
  })

  it('按到期顺序时保持最早到期的在前', () => {
    const cards = [
      makeCard({ id: 'late', dueAt: 100 }),
      makeCard({ id: 'early', dueAt: 1 }),
      makeCard({ id: 'mid', dueAt: 50 }),
    ]

    const queue = buildSessionQueue(cards, 'due')
    expect(queue.map((card) => card.id)).toEqual(['early', 'mid', 'late'])
  })
})

describe('题型规划', () => {
  it('难度配比仍然是 30/50/20，并给每个槽位分配题型', () => {
    const plan = buildQuestionPlan(3, 2, ['qa', 'choice', 'truefalse'])
    expect(plan).toHaveLength(3)

    const difficulties = plan.flat().map((slot) => slot.difficulty)
    const counts = { easy: 0, medium: 0, hard: 0 }
    for (const difficulty of difficulties) counts[difficulty] += 1
    expect(counts).toEqual({ easy: 2, medium: 3, hard: 1 })

    // 每个槽位都有题型
    for (const slot of plan.flat()) {
      expect(['qa', 'choice', 'truefalse']).toContain(slot.type)
    }
  })

  it('未配置任何题型时回退到问答', () => {
    const plan = buildQuestionPlan(1, 1, [])
    expect(plan[0][0].type).toBe('qa')
  })
})

describe('新题型生成', () => {
  it('能生成选择题、判断题与填空题', async () => {
    const provider = new FakeProvider()
    const concepts = [
      { title: '甲', statement: '甲的陈述。', tags: [] },
      { title: '乙', statement: '乙的陈述。', tags: [] },
    ]

    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 3,
      formats: ['qa', 'choice', 'truefalse'],
    })

    const types = new Set(questions.map((question) => question.type))
    expect(types.has('choice')).toBe(true)
    expect(types.has('truefalse')).toBe(true)

    for (const question of questions) {
      if (question.type === 'choice') {
        expect(question.options?.length).toBeGreaterThanOrEqual(3)
        expect(question.correctIndex).toBeGreaterThanOrEqual(0)
        expect(question.correctIndex!).toBeLessThan(question.options!.length)
      }
      if (question.type === 'truefalse') {
        expect(['正确', '错误']).toContain(question.answer)
      }
    }
  })

  it('选择题缺少选项时降级为问答', async () => {
    const provider = new FakeProvider()
    // 让模型返回没有选项的 choice
    const original = provider.generate.bind(provider)
    provider.generate = async (messages, options) => {
      const text = await original(messages, options)
      return text.replace(/"options":\[[^\]]*\]/g, '"options":[]')
    }

    const concepts = [{ title: '甲', statement: '甲的陈述。', tags: [] }]
    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 1,
      formats: ['choice'],
    })

    expect(questions[0].type).toBe('qa')
    expect(questions[0].options).toBeUndefined()
  })

  it('判断题答案统一成「正确 / 错误」', async () => {
    const provider = new FakeProvider()
    const original = provider.generate.bind(provider)
    provider.generate = async (messages, options) => {
      const text = await original(messages, options)
      return text.replace(/"answer":"错误"/g, '"answer":"错"')
    }

    const concepts = [{ title: '甲', statement: '甲的陈述。', tags: [] }]
    const questions = await generateQuestions(provider, concepts, {
      questionsPerConcept: 2,
      formats: ['truefalse'],
    })

    for (const question of questions) {
      if (question.type === 'truefalse') {
        expect(['正确', '错误']).toContain(question.answer)
      }
    }
  })
})

describe('单选/判断题的本地判定', () => {
  it('选对时建议「良好」，选错时建议「重来」，不需要调用模型', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, {
      ...settings,
      questionTypes: ['choice'],
    }, new FakeProvider())

    const card = (await cardsRepo.listDue(Date.now()))[0]
    expect(card.type).toBe('choice')

    useStudy.getState().start([card])

    useStudy.getState().selectOption(card.correctIndex!)
    expect(useStudy.getState().revealed).toBe(true)
    expect(useStudy.getState().suggestedGrade).toBe('good')

    // 选错
    useStudy.getState().reset()
    useStudy.getState().start([card])
    const wrong = card.correctIndex === 0 ? 1 : 0
    useStudy.getState().selectOption(wrong)
    expect(useStudy.getState().suggestedGrade).toBe('again')
  })
})

describe('错因归因', () => {
  it('归因结果被写进复习记录', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    await useStudy.getState().submit('again')

    // 答错后进入归因流程
    expect(useStudy.getState().attribution).toBeTruthy()

    await useStudy.getState().attributeCause('not_understood')

    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].errorCause).toBe('not_understood')
    expect(logs[0].rating).toBe(1)
  })

  it('跳过归因也能正常进入下一张', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    await useStudy.getState().submit('again')
    useStudy.getState().skipAttribution()

    expect(useStudy.getState().attribution).toBeNull()
    expect(useStudy.getState().index).toBe(1)

    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].errorCause).toBeUndefined()
  })

  it('答对时不追问归因', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    await useStudy.getState().submit('good')

    expect(useStudy.getState().attribution).toBeNull()
    expect(useStudy.getState().index).toBe(1)
  })
})

describe('到期提醒', () => {
  it('徽标只显示数量，不包含卡片内容', () => {
    updateAppBadge(3)
    expect(document.title).toBe('(3) 记忆训练')

    updateAppBadge(0)
    expect(document.title).toBe('记忆训练 · SaveMemory')
  })
})
