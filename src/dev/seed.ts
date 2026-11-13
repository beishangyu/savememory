import { cardsRepo, conceptsRepo, sourcesRepo } from '../db/repo'
import type { Card, Concept, Difficulty, Source } from '../db/schema'
import { createNewCard } from '../fsrs/scheduler'
import { uid } from '../lib/id'

/**
 * Development-only helper that fills the local database with sample material so
 * the study UI can be exercised without calling a real model.
 *
 * It is exposed on `window.__memory.seedDemo()` in dev builds only.
 */

interface DemoConcept {
  title: string
  statement: string
  tags: string[]
  questions: Array<{ type: Card['type']; prompt: string; answer: string; difficulty: Difficulty }>
}

const DEMO_CONCEPTS: DemoConcept[] = [
  {
    title: 'TCP 三次握手',
    statement: 'TCP 建立连接需要三次握手，第三次握手携带 ACK 并确认服务器的 SYN。',
    tags: ['网络', 'TCP'],
    questions: [
      {
        type: 'qa',
        prompt: 'TCP 建立连接需要几次握手？',
        answer: '三次握手。',
        difficulty: 'easy',
      },
      {
        type: 'qa',
        prompt: '第三次握手的作用是什么？',
        answer: '发送 ACK，确认服务器的 SYN 并同步双方的初始序列号。',
        difficulty: 'medium',
      },
      {
        type: 'cloze',
        prompt: 'TCP 建立连接使用 {{三次握手}}，目的是同步双方的初始序列号。',
        answer: '三次握手',
        difficulty: 'medium',
      },
    ],
  },
  {
    title: '进程与线程',
    statement: '进程是资源分配的基本单位，线程是 CPU 调度的基本单位。',
    tags: ['操作系统'],
    questions: [
      {
        type: 'qa',
        prompt: '什么是资源分配的基本单位？',
        answer: '进程。',
        difficulty: 'easy',
      },
      {
        type: 'qa',
        prompt: 'CPU 调度以什么为单位？',
        answer: '线程。',
        difficulty: 'medium',
      },
    ],
  },
  {
    title: 'FSRS 保持率',
    statement: 'FSRS 的目标保持率指复习到期时，记忆仍能被正确回忆的概率。',
    tags: ['记忆', 'FSRS'],
    questions: [
      {
        type: 'qa',
        prompt: '目标保持率衡量的是什么？',
        answer: '到期时记忆仍能被正确回忆的概率。',
        difficulty: 'hard',
      },
      {
        type: 'cloze',
        prompt: '目标保持率越高，复习间隔越 {{短}}。',
        answer: '短',
        difficulty: 'medium',
      },
    ],
  },
]

export async function seedDemoData(): Promise<{ source: Source; cards: Card[] }> {
  const source: Source = {
    id: uid('src'),
    kind: 'text',
    title: '演示材料 · 计算机基础',
    text: DEMO_CONCEPTS.map((concept) => concept.statement).join('\n\n'),
    createdAt: Date.now(),
    generationStatus: 'done',
  }
  await sourcesRepo.put(source)

  const concepts: Concept[] = []
  const cards: Card[] = []

  for (const [index, demo] of DEMO_CONCEPTS.entries()) {
    const concept: Concept = {
      id: uid('con'),
      sourceId: source.id,
      index,
      title: demo.title,
      statement: demo.statement,
      tags: demo.tags,
      createdAt: Date.now(),
    }
    concepts.push(concept)

    for (const question of demo.questions) {
      const card = await createNewCard(
        { desiredRetention: 0.9, maximumInterval: 36500 },
        uid('card'),
      )
      card.conceptId = concept.id
      card.sourceId = source.id
      card.type = question.type
      card.prompt = question.prompt
      card.answer = question.answer
      card.questionDifficulty = question.difficulty
      cards.push(card)
    }
  }

  await conceptsRepo.bulkPut(concepts)
  await cardsRepo.bulkPut(cards)

  return { source, cards }
}
