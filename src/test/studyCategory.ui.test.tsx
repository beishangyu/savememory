// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { createNewCard } from '../fsrs/scheduler'
import { uid } from '../lib/id'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { useScope } from '../store/scope'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: '' }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

/** Three due cards: two in 「四级」, one in 「口语」. */
async function seedDueCards() {
  const now = Date.now()
  await db.sources.put({
    id: 'src-1',
    kind: 'text',
    title: '词表',
    text: '',
    createdAt: now,
    generationStatus: 'done',
  })

  const entries = [
    { id: 'c1', title: 'apple', categories: ['四级'] },
    { id: 'c2', title: 'banana', categories: ['四级'] },
    { id: 'c3', title: 'hello', categories: ['口语'] },
  ]

  for (const [index, entry] of entries.entries()) {
    await db.concepts.put({
      id: entry.id,
      sourceId: 'src-1',
      index,
      title: entry.title,
      statement: entry.title,
      tags: [],
      categories: entry.categories,
      createdAt: now,
    })
    const card = await createNewCard(
      { desiredRetention: 0.9, maximumInterval: 36500 },
      uid('card'),
    )
    card.conceptId = entry.id
    card.sourceId = 'src-1'
    card.prompt = entry.title
    card.answer = entry.title
    card.dueAt = now - 1000
    await cardsRepo.put(card)
  }
}

async function openStudy() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: '导入' })
  await user.click(screen.getByRole('button', { name: /学习/ }))
  await screen.findByRole('heading', { name: '学习' })
  return user
}

describe('按分类学习', () => {
  it('开始页列出各分类的到期卡片数', async () => {
    await seedDueCards()
    await openStudy()

    expect(await screen.findByText('按分类学习')).toBeTruthy()
    // 「四级」有两张到期卡片，「口语」有一张。
    const four = await screen.findByRole('button', { name: /四级/ })
    expect(four.textContent).toContain('2')
    const spoken = screen.getByRole('button', { name: /口语/ })
    expect(spoken.textContent).toContain('1')
  })

  it('分类来自卡片库，并标出「到期 / 总数」', async () => {
    // 一张还没到期的卡片：分类仍然要出现在选择器里，但到期数是 0。
    const now = Date.now()
    await db.sources.put({
      id: 'src-2',
      kind: 'text',
      title: '生词本',
      text: '',
      createdAt: now,
      generationStatus: 'done',
    })
    await db.concepts.put({
      id: 'c4',
      sourceId: 'src-2',
      index: 0,
      title: 'later',
      statement: 'later',
      tags: [],
      categories: ['稍后'],
      createdAt: now,
    })
    const card = await createNewCard(
      { desiredRetention: 0.9, maximumInterval: 36500 },
      uid('card'),
    )
    card.conceptId = 'c4'
    card.sourceId = 'src-2'
    card.prompt = 'later'
    card.answer = 'later'
    card.dueAt = now + 86_400_000
    await cardsRepo.put(card)

    await openStudy()

    const later = await screen.findByRole('button', { name: /稍后/ })
    // 0 张到期，一共 1 张。
    expect(later.textContent).toContain('0/1')
  })

  it('选中分类后只学这个分类', async () => {
    await seedDueCards()
    const user = await openStudy()

    await user.click(await screen.findByRole('button', { name: /四级/ }))

    // 大数字变成该分类的到期数量。
    await waitFor(() => {
      expect(screen.getByText('张卡片已到期 · 只学「四级」')).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: '开始学习' }))

    // 队列里只有「四级」的两张卡（顺序由交错练习决定）。
    await screen.findByRole('heading', { level: 2 })
    expect(screen.getByText(/进度 1 \/ 2/)).toBeTruthy()
    const prompt = screen.getByRole('heading', { level: 2 }).textContent
    expect(['apple', 'banana']).toContain(prompt)
  })

  it('选「全部」则复习所有到期卡片', async () => {
    await seedDueCards()
    const user = await openStudy()

    await user.click(screen.getByRole('button', { name: '开始学习' }))

    await screen.findByRole('heading', { level: 2 })
    expect(screen.getByText(/进度 1 \/ 3/)).toBeTruthy()
  })

  it('会话结束时会说明本次的分类范围', async () => {
    await seedDueCards()
    const user = await openStudy()

    await user.click(await screen.findByRole('button', { name: /口语/ }))
    await user.click(screen.getByRole('button', { name: '开始学习' }))

    await screen.findByRole('heading', { level: 2 })
    await user.click(screen.getByRole('button', { name: '显示答案' }))
    await user.click(screen.getByRole('button', { name: /良好/ }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '本次会话完成' })).toBeTruthy()
    })
    expect(screen.getByText('本次只复习了「口语」分类。')).toBeTruthy()
  })

  it('交接过来的分类已被删除时，自动回到「全部」', async () => {
    await seedDueCards()
    // 卡片库里那个分类已经被删掉，但学习范围还记着它。
    useScope.setState({ category: '已删除' })
    await openStudy()

    await waitFor(() => {
      expect(useScope.getState().category).toBeNull()
    })
    expect(screen.getByText('张卡片已到期')).toBeTruthy()
  })

  it('没有到期卡片时不显示分类选择器', async () => {
    await openStudy()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '暂无到期卡片' })).toBeTruthy()
    })
    expect(screen.queryByText('按分类学习')).toBeNull()
  })
})
