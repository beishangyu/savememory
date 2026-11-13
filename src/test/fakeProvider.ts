import { LLMError, type LLMMessage, type LLMOptions, type LLMProvider } from '../llm/types'

export interface FakeJudgement {
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  suggestedRating: number
}

/**
 * A deterministic stand-in for a real model.
 *
 * It parses the prompts we send and produces structurally valid JSON, so the
 * real pipeline (parsing, schema validation, chunking, difficulty balancing,
 * image reading, answer judging) is exercised end to end without any network
 * access.
 */
export class FakeProvider implements LLMProvider {
  readonly kind = 'openai' as const
  readonly model = 'fake-model'
  readonly prompts: string[] = []

  private readonly allQuestionsMedium: boolean
  private readonly imageText: string
  private readonly judgement: FakeJudgement | null
  private readonly failVision: boolean
  private readonly failJudgement: boolean

  constructor(
    options: {
      allQuestionsMedium?: boolean
      imageText?: string
      judgement?: FakeJudgement
      failVision?: boolean
      failJudgement?: boolean
    } = {},
  ) {
    this.allQuestionsMedium = options.allQuestionsMedium ?? false
    this.imageText = options.imageText ?? '这是从图片中识别出来的文字内容。'
    this.judgement = options.judgement ?? null
    this.failVision = options.failVision ?? false
    this.failJudgement = options.failJudgement ?? false
  }

  async generate(messages: LLMMessage[], _options?: LLMOptions): Promise<string> {
    const last = messages[messages.length - 1]?.text ?? ''
    this.prompts.push(last)

    if (last.includes('图片内容识别器')) {
      if (this.failVision) {
        throw new LLMError('模型接口返回 400：image_url is not supported by this model', {
          status: 400,
          provider: 'openai',
          raw: 'image_url is not supported by this model',
          visionUnsupported: true,
        })
      }
      return JSON.stringify({
        text: this.imageText,
        title: '识别出的标题',
        language: 'zh',
        hasFormula: false,
        semanticSummary: '这是一张笔记截图。',
      })
    }

    if (last.includes('判卷器')) {
      if (this.failJudgement) {
        throw new LLMError('模型接口返回 500：internal error', {
          status: 500,
          provider: 'openai',
        })
      }
      return JSON.stringify(this.judgement ?? this.guessJudgement(last))
    }

    if (last.includes('概念切分器')) {
      return JSON.stringify({
        concepts: [
          {
            title: '三次握手',
            statement: 'TCP 建立连接需要三次握手。',
            elaboration: '第一次 SYN，第二次 SYN+ACK，第三次 ACK。',
            tags: ['网络'],
          },
          {
            title: '进程与线程',
            statement: '进程是资源分配的基本单位，线程是调度的基本单位。',
            tags: ['操作系统'],
          },
          {
            title: '目标保持率',
            statement: '目标保持率是到期时仍能正确回忆的概率。',
            tags: ['记忆'],
          },
        ],
      })
    }

    if (last.includes('提取练习出题器')) {
      return JSON.stringify({ questions: this.buildQuestions(last) })
    }

    if (last.includes('目标配比')) {
      return JSON.stringify({ labels: this.buildLabels(last) })
    }

    throw new Error(`FakeProvider 收到未预期的提示：${last.slice(0, 60)}`)
  }

  /** A simple heuristic: exact match is correct, partial text is partial. */
  private guessJudgement(prompt: string): FakeJudgement {
    const reference = prompt.match(/参考答案：(.*)/)?.[1]?.trim() ?? ''
    const answer = prompt.match(/用户的作答：(.*)/)?.[1]?.trim() ?? ''

    if (!answer) {
      return { verdict: 'incorrect', feedback: '没有作答。', suggestedRating: 1 }
    }
    if (reference && answer.includes(reference)) {
      return { verdict: 'correct', feedback: '答案完全正确。', suggestedRating: 4 }
    }
    if (answer.length >= 4) {
      return { verdict: 'partial', feedback: '说对了一部分，但缺少关键要点。', suggestedRating: 2 }
    }
    return { verdict: 'incorrect', feedback: '与参考答案不符。', suggestedRating: 1 }
  }

  /** Parse the concept/slot structure back out of the prompt. */
  private buildQuestions(prompt: string) {
    const conceptIndices = [...prompt.matchAll(/概念 (\d+)：/g)].map((match) => Number(match[1]))
    const questions: unknown[] = []

    for (const conceptIndex of conceptIndices) {
      const block = prompt.split(`概念 ${conceptIndex}：`)[1]?.split('\n\n')[0] ?? ''
      const slots = [...block.matchAll(/第 (\d+) 题，难度=(\w+)/g)]

      for (const slot of slots) {
        questions.push({
          conceptIndex,
          slotIndex: Number(slot[1]) - 1,
          type: 'qa',
          prompt: `概念 ${conceptIndex} 的第 ${slot[1]} 个测试问题是什么？`,
          answer: `这是概念 ${conceptIndex} 的参考答案。`,
          difficulty: this.allQuestionsMedium ? 'medium' : slot[2],
        })
      }
    }

    return questions
  }

  /** Parse the target counts and spread the labels accordingly. */
  private buildLabels(prompt: string) {
    const match = prompt.match(/目标配比：简单 (\d+) 题、中等 (\d+) 题、困难 (\d+) 题/)
    if (!match) return []

    const easy = Number(match[1])
    const medium = Number(match[2])
    const hard = Number(match[3])

    const labels: Array<{ index: number; difficulty: string }> = []
    let index = 0
    for (let i = 0; i < easy; i += 1) labels.push({ index: index++, difficulty: 'easy' })
    for (let i = 0; i < medium; i += 1) labels.push({ index: index++, difficulty: 'medium' })
    for (let i = 0; i < hard; i += 1) labels.push({ index: index++, difficulty: 'hard' })
    return labels
  }
}

/** A provider whose output is not valid JSON, to exercise the retry path. */
export class BrokenProvider implements LLMProvider {
  readonly kind = 'openai' as const
  readonly model = 'broken-model'
  attempts = 0

  async generate(): Promise<string> {
    this.attempts += 1
    return '抱歉，我无法完成这个请求。'
  }
}

/**
 * A provider that always returns a judgement whose verdict and rating
 * contradict each other, to exercise the consistency check.
 */
export class InconsistentJudgementProvider implements LLMProvider {
  readonly kind = 'openai' as const
  readonly model = 'inconsistent-model'
  attempts = 0

  async generate(messages: LLMMessage[]): Promise<string> {
    this.attempts += 1
    const last = messages[messages.length - 1]?.text ?? ''
    if (last.includes('判卷器')) {
      return JSON.stringify({
        verdict: 'correct',
        feedback: '答案完全正确。',
        suggestedRating: 1,
      })
    }
    return '{}'
  }
}
