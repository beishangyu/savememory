// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { conceptsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: '' }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

/** Two materials with different categories. */
async function seed() {
  const now = Date.now()
  const make = async (
    sourceId: string,
    title: string,
    concepts: Array<{ id: string; title: string; categories?: string[] }>,
  ) => {
    await db.sources.put({
      id: sourceId,
      kind: 'text',
      title,
      text: '',
      createdAt: now,
      generationStatus: 'done',
    })
    await conceptsRepo.bulkPut(
      concepts.map((concept, index) => ({
        id: concept.id,
        sourceId,
        index,
        title: concept.title,
        statement: concept.title,
        tags: [],
        categories: concept.categories ?? [],
        createdAt: now,
      })),
    )
  }

  await make('src-1', '四级词汇', [
    { id: 'c1', title: 'apple', categories: ['四级'] },
    { id: 'c2', title: 'banana', categories: ['四级'] },
  ])
  await make('src-2', '日常口语', [
    { id: 'c3', title: 'hello', categories: ['口语'] },
  ])
}

async function openLibrary() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: '导入' })
  await user.click(screen.getByRole('button', { name: '卡片库' }))
  await screen.findByRole('heading', { name: '卡片库' })
  return user
}

/** The library loads asynchronously — wait for the material to show up. */
async function waitForMaterial(title: string) {
  await screen.findByText(title)
}

describe('卡片库分类', () => {
  /** The concept block of a word (the title and the statement share the text). */
  function blockOf(word: string): HTMLElement {
    const title = screen.getAllByText(word)[0]
    const block = title.closest('.concept-block')
    if (!block) throw new Error(`找不到 ${word} 所在的概念块`)
    return block as HTMLElement
  }

  it('列出所有分类并能筛选', async () => {
    await seed()
    const user = await openLibrary()

    // 分类栏里有「四级」和「口语」。
    expect(await screen.findByText('四级')).toBeTruthy()
    expect(screen.getByText('口语')).toBeTruthy()

    // 展开「四级词汇」这份材料。
    await waitForMaterial('四级词汇')
    await user.click(screen.getByText('四级词汇'))
    await waitFor(() => {
      expect(screen.getAllByText('apple').length).toBeGreaterThan(0)
    })

    // 点「口语」分类，只剩下口语那份材料。
    await user.click(screen.getByRole('button', { name: /口语/ }))

    await waitFor(() => {
      expect(screen.queryByText('四级词汇')).toBeNull()
      expect(screen.getByText('日常口语')).toBeTruthy()
    })
  })

  it('搜索能按单词和释义过滤', async () => {
    await seed()
    const user = await openLibrary()

    await waitForMaterial('四级词汇')
    await user.click(screen.getByText('四级词汇'))
    await waitFor(() => {
      expect(screen.getAllByText('apple').length).toBeGreaterThan(0)
    })

    const search = screen.getByLabelText('搜索')
    fireEvent.change(search, { target: { value: 'banana' } })

    await waitFor(() => {
      expect(screen.queryAllByText('apple')).toHaveLength(0)
      expect(screen.getAllByText('banana').length).toBeGreaterThan(0)
    })
  })

  it('可以给词条就地加分类', async () => {
    await seed()
    const user = await openLibrary()

    await waitForMaterial('四级词汇')
    await user.click(screen.getByText('四级词汇'))
    await waitFor(() => {
      expect(screen.getAllByText('apple').length).toBeGreaterThan(0)
    })

    const block = blockOf('apple')
    await user.click(within(block).getByRole('button', { name: '+' }))

    const input = within(block).getByPlaceholderText('输入分类名')
    fireEvent.change(input, { target: { value: '易错' } })
    await user.type(input, '{Enter}')

    await waitFor(async () => {
      const concept = await conceptsRepo.get('c1')
      expect(concept?.categories).toEqual(['四级', '易错'])
    })
  })

  it('可以移除分类', async () => {
    await seed()
    const user = await openLibrary()

    await waitForMaterial('四级词汇')
    await user.click(screen.getByText('四级词汇'))
    await waitFor(() => {
      expect(screen.getAllByText('apple').length).toBeGreaterThan(0)
    })

    const block = blockOf('apple')
    await user.click(within(block).getByRole('button', { name: '移除分类 四级' }))

    await waitFor(async () => {
      const concept = await conceptsRepo.get('c1')
      expect(concept?.categories).toEqual([])
    })
  })

  it('可以给整份材料加分类', async () => {
    await seed()
    const user = await openLibrary()

    await waitForMaterial('四级词汇')
    await user.click(screen.getByText('四级词汇'))
    await waitFor(() => {
      expect(screen.getAllByText('apple').length).toBeGreaterThan(0)
    })

    const bulk = screen.getByText('给这份材料的全部词条加分类：')
    const scope = bulk.closest('.source-bulk')
    expect(scope).toBeTruthy()
    await user.click(within(scope as HTMLElement).getByRole('button', { name: /加到这份材料/ }))

    const input = within(scope as HTMLElement).getByPlaceholderText('输入分类名')
    fireEvent.change(input, { target: { value: '考试' } })
    await user.type(input, '{Enter}')

    await waitFor(async () => {
      const first = await conceptsRepo.get('c1')
      const second = await conceptsRepo.get('c2')
      expect(first?.categories).toEqual(['四级', '考试'])
      expect(second?.categories).toEqual(['四级', '考试'])
    })
  })

  it('没有分类时给出提示', async () => {
    await openLibrary()
    expect(await screen.findByText(/还没有分类/)).toBeTruthy()
  })

  it('选中分类后可以直接按这个分类去学习', async () => {
    await seed()
    const user = await openLibrary()

    // 选中「口语」。
    await user.click(await screen.findByRole('button', { name: /口语/ }))

    const studyButton = await screen.findByRole('button', { name: '按「口语」分类学习' })
    await user.click(studyButton)

    // 跳到了学习页，并且范围就是「口语」。
    await screen.findByRole('heading', { name: '学习' })
    expect(screen.getByText('张卡片已到期 · 只学「口语」')).toBeTruthy()
  })
})
