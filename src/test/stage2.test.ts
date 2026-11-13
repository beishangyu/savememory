import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Settings } from '../db/schema'
import { judgeAnswer } from '../llm/judge'
import { JudgementSchema, VERDICT_ALLOWED_RATINGS } from '../llm/schemas'
import { looksLikeVisionError } from '../llm/types'
import {
  continueWithManualText,
  createImageSource,
  createTextSource,
  generateForSource,
  ImageReadError,
} from '../services/ingest'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import {
  BrokenProvider,
  FakeProvider,
  InconsistentJudgementProvider,
} from './fakeProvider'

const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' }

function makeImageBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings, loaded: true })
  useStudy.getState().reset()
})

describe('图片输入', () => {
  it('图片源先读图，再进入文本管道生成卡片', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')
    expect(source.kind).toBe('image')
    expect(source.text).toBe('')

    const result = await generateForSource(source.id, settings, new FakeProvider())

    expect(result.concepts).toHaveLength(3)
    expect(result.cards).toHaveLength(6)

    // 读出的文字被写回材料，重试时不再重复读图
    expect(result.source.text).toContain('这是从图片中识别出来的文字内容。')
    expect(result.source.textExtractedFromImage).toBe(true)

    const due = await cardsRepo.listDue(Date.now())
    expect(due).toHaveLength(6)
  })

  it('图片存在本地数据库中（Blob 原样保存）', async () => {
    const blob = makeImageBlob()
    const source = await createImageSource(blob, '笔记截图', 'image/png')
    await generateForSource(source.id, settings, new FakeProvider())

    const stored = await db.sources.get(source.id)
    expect(stored?.image).toBeInstanceOf(Blob)
    expect(stored?.image?.size).toBe(blob.size)
    expect(stored?.kind).toBe('image')
  })

  it('模型不支持读图时抛出 ImageReadError，交由界面手动补录', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')

    await expect(
      generateForSource(source.id, settings, new FakeProvider({ failVision: true })),
    ).rejects.toBeInstanceOf(ImageReadError)

    // 材料本身被保留下来，用户可以重试
    const stored = await db.sources.get(source.id)
    expect(stored?.generationStatus).toBe('failed')
    expect(stored?.image).toBeInstanceOf(Blob)
  })

  it('手动补录文字后继续走原有管道', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')

    const result = await continueWithManualText(
      source.id,
      '手动输入的内容：TCP 需要三次握手。',
      settings,
      new FakeProvider(),
    )

    expect(result.cards).toHaveLength(6)
    expect(result.source.text).toBe('手动输入的内容：TCP 需要三次握手。')

    const due = await cardsRepo.listDue(Date.now())
    expect(due).toHaveLength(6)
  })

  it('读图失败后手动补录同样能产出卡片', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')

    await expect(
      generateForSource(source.id, settings, new FakeProvider({ failVision: true })),
    ).rejects.toBeInstanceOf(ImageReadError)

    const result = await continueWithManualText(
      source.id,
      '对照图片手动输入的内容。',
      settings,
      new FakeProvider(),
    )
    expect(result.cards).toHaveLength(6)
  })
})

describe('视觉错误的识别', () => {
  it('能识别出「模型不支持图片」这类报错', () => {
    expect(
      looksLikeVisionError(400, 'image_url is not supported by this model'),
    ).toBe(true)
    expect(
      looksLikeVisionError(400, 'Invalid request: inlineData is not supported'),
    ).toBe(true)
    expect(
      looksLikeVisionError(415, 'This model does not support multimodal input'),
    ).toBe(true)
  })

  it('不会把无关报错误判成视觉问题', () => {
    expect(looksLikeVisionError(401, 'Invalid API key provided')).toBe(false)
    expect(looksLikeVisionError(429, 'Rate limit exceeded')).toBe(false)
    expect(looksLikeVisionError(500, 'Internal server error')).toBe(false)
  })
})

describe('可选的自定义 OCR 接口', () => {
  it('视觉失败后自动调用 OCR 接口并继续生成', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: '来自自定义 OCR 接口的文字。' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await generateForSource(
        source.id,
        { ...settings, ocrEndpoint: 'https://example.com/ocr' },
        new FakeProvider({ failVision: true }),
      )

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(result.source.text).toContain('来自自定义 OCR 接口的文字。')
      expect(result.cards).toHaveLength(6)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('OCR 接口不可用时仍然退回手动补录', async () => {
    const source = await createImageSource(makeImageBlob(), '笔记截图', 'image/png')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )

    try {
      await expect(
        generateForSource(
          source.id,
          { ...settings, ocrEndpoint: 'https://example.com/ocr' },
          new FakeProvider({ failVision: true }),
        ),
      ).rejects.toBeInstanceOf(ImageReadError)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('AI 评判的 schema 校验', () => {
  it('接受自洽的 verdict / suggestedRating 组合', () => {
    for (const [verdict, allowed] of Object.entries(VERDICT_ALLOWED_RATINGS)) {
      for (const rating of allowed) {
        const parsed = JudgementSchema.safeParse({
          verdict,
          feedback: '看起来还行。',
          suggestedRating: rating,
        })
        expect(parsed.success).toBe(true)
      }
    }
  })

  it('拒绝自相矛盾的 verdict / suggestedRating 组合', () => {
    expect(
      JudgementSchema.safeParse({
        verdict: 'correct',
        feedback: '还行',
        suggestedRating: 1,
      }).success,
    ).toBe(false)

    expect(
      JudgementSchema.safeParse({
        verdict: 'partial',
        feedback: '还行',
        suggestedRating: 4,
      }).success,
    ).toBe(false)

    expect(
      JudgementSchema.safeParse({
        verdict: 'incorrect',
        feedback: '还行',
        suggestedRating: 3,
      }).success,
    ).toBe(false)
  })

  it('拒绝缺失反馈、非整数评分和越界评分', () => {
    expect(
      JudgementSchema.safeParse({ verdict: 'correct', feedback: '', suggestedRating: 3 }).success,
    ).toBe(false)

    expect(
      JudgementSchema.safeParse({ verdict: 'correct', feedback: '好', suggestedRating: 3.5 })
        .success,
    ).toBe(false)

    expect(
      JudgementSchema.safeParse({ verdict: 'correct', feedback: '好', suggestedRating: 5 }).success,
    ).toBe(false)

    expect(
      JudgementSchema.safeParse({ verdict: 'maybe', feedback: '好', suggestedRating: 3 }).success,
    ).toBe(false)
  })

  it('模型一直返回矛盾结果时，重试用尽后抛错而不是给出错误评分', async () => {
    const provider = new InconsistentJudgementProvider()
    await expect(
      judgeAnswer(provider, {
        prompt: '题目',
        reference: '参考答案',
        userAnswer: '用户的答案',
      }),
    ).rejects.toThrow(/校验失败/)

    // 1 次首发 + 2 次重试
    expect(provider.attempts).toBe(3)
  })
})

describe('AI 评判模式的学习会话', () => {
  it('评判成功后给出档位建议，并写入 AI 评判元数据', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useSettings.setState({
      settings: { ...settings, gradingMode: 'ai' },
      loaded: true,
    })

    useStudy.getState().start(due)
    useStudy.getState().setUserAnswer('这是概念 0 的参考答案。')

    await useStudy.getState().judge(
      new FakeProvider({
        judgement: { verdict: 'correct', feedback: '答得很准确。', suggestedRating: 4 },
      }),
    )

    expect(useStudy.getState().judgement?.verdict).toBe('correct')
    expect(useStudy.getState().suggestedGrade).toBe('easy')
    expect(useStudy.getState().revealed).toBe(true)

    await useStudy.getState().submit('easy')

    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].mode).toBe('ai')
    expect(logs[0].aiVerdict).toBe('correct')
    expect(logs[0].aiSuggestedRating).toBe(4)
    expect(logs[0].aiFeedback).toBe('答得很准确。')
    expect(logs[0].rating).toBe(4)
  })

  it('用户可以覆盖 AI 的建议，改选其它档位', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    useStudy.getState().setUserAnswer('我的答案')

    await useStudy.getState().judge(
      new FakeProvider({
        judgement: { verdict: 'partial', feedback: '差一点。', suggestedRating: 2 },
      }),
    )
    expect(useStudy.getState().suggestedGrade).toBe('hard')

    // 用户选择「重来」
    await useStudy.getState().submit('again')

    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].rating).toBe(1)
    expect(logs[0].aiSuggestedRating).toBe(2)
    expect(logs[0].mode).toBe('ai')
  })

  it('评判失败时退回手动评分，绝不写入未经校验的分数', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    useStudy.getState().setUserAnswer('我的答案')

    await useStudy.getState().judge(new BrokenProvider())

    // 没有判定结果，但已经展示参考答案，用户可以自己打分
    expect(useStudy.getState().judgement).toBeNull()
    expect(useStudy.getState().suggestedGrade).toBeNull()
    expect(useStudy.getState().judgeError).toContain('手动评分')
    expect(useStudy.getState().revealed).toBe(true)

    // 没有任何复习记录被写入
    expect(await reviewLogsRepo.count()).toBe(0)

    // 手动打分仍然正常工作
    await useStudy.getState().submit('good')
    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].mode).toBe('self')
    expect(logs[0].aiVerdict).toBeUndefined()
    expect(logs[0].rating).toBe(3)
  })

  it('未作答时直接判为「重来」，不调用模型', async () => {
    const source = await createTextSource('材料', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())
    const due = await cardsRepo.listDue(Date.now())

    useStudy.getState().start(due)
    useStudy.getState().setUserAnswer('   ')

    await useStudy.getState().judge(new FakeProvider())

    expect(useStudy.getState().suggestedGrade).toBe('again')
    expect(useStudy.getState().revealed).toBe(true)
  })
})
