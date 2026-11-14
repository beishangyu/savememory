// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo, memosRepo, settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Memo } from '../db/schema'
import { buildBackup, importBackup } from '../services/backup'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

const mocks = vi.hoisted(() => ({
  provider: undefined as unknown,
}))

vi.mock('../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm')>()
  const { FakeProvider } = await import('./fakeProvider')
  mocks.provider = new FakeProvider()
  return {
    ...actual,
    providerFromSettings: () => mocks.provider,
    visionProviderFromSettings: () => mocks.provider,
  }
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: 'test-key' })
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('备忘录', () => {
  it('新建、编辑与删除', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '备忘' }))
    expect(await screen.findByRole('heading', { name: '备忘录' })).toBeTruthy()

    // 新建
    await user.click(screen.getByRole('button', { name: /写一条/ }))
    await user.type(screen.getByPlaceholderText('一句话概括这条备忘'), '购物清单')
    await user.type(screen.getByPlaceholderText('想到什么就写什么…'), '咖啡豆、牛奶')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByText('购物清单')).toBeTruthy()
    })
    expect(await memosRepo.count()).toBe(1)

    // 编辑
    await user.click(screen.getByRole('button', { name: '编辑' }))
    const titleInput = screen.getByPlaceholderText('一句话概括这条备忘')
    await user.clear(titleInput)
    await user.type(titleInput, '购物清单（改）')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(screen.getByText('购物清单（改）')).toBeTruthy()
    })

    // 删除
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(screen.queryByText('购物清单（改）')).toBeNull()
    })
    expect(await memosRepo.count()).toBe(0)
  })

  it('可以搜索备忘', async () => {
    const now = Date.now()
    const seed: Memo[] = [
      { id: 'm1', title: '读书', content: '《认知天性》', createdAt: now, updatedAt: now, pinned: false },
      { id: 'm2', title: '待办', content: '交房租', createdAt: now, updatedAt: now, pinned: false },
    ]
    for (const memo of seed) await memosRepo.put(memo)

    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })
    await user.click(screen.getByRole('button', { name: '备忘' }))
    await screen.findByRole('heading', { name: '备忘录' })

    await user.type(screen.getByPlaceholderText('按标题或内容过滤…'), '房租')
    await waitFor(() => {
      expect(screen.queryByText('读书')).toBeNull()
    })
    expect(screen.getByText('待办')).toBeTruthy()
  })

  it('置顶的备忘排在最前面', async () => {
    const now = Date.now()
    await memosRepo.put({
      id: 'older',
      title: '普通',
      content: '普通备忘',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      pinned: false,
    })
    await memosRepo.put({
      id: 'pinned',
      title: '置顶',
      content: '置顶备忘',
      createdAt: now,
      updatedAt: now,
      pinned: true,
    })

    const list = await memosRepo.list()
    expect(list[0].id).toBe('pinned')
  })

  it('一键转为学习材料，走完整的出题管道', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '备忘' }))
    await screen.findByRole('heading', { name: '备忘录' })

    await user.click(screen.getByRole('button', { name: /写一条/ }))
    await user.type(
      screen.getByPlaceholderText('想到什么就写什么…'),
      'TCP 建立连接需要三次握手。进程是资源分配的基本单位。',
    )
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByText('（无标题）')).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: '转为学习材料' }))

    await waitFor(() => {
      expect(screen.getByText(/已生成 \d+ 个原子概念/)).toBeTruthy()
    })

    // 备忘录被标记为已转换，卡片也真的入库了
    const memos = await memosRepo.list()
    expect(memos[0].sourceId).toBeTruthy()
    expect(memos[0].cardCount).toBeGreaterThan(0)
    expect(await cardsRepo.count()).toBe(memos[0].cardCount)
  })
})

describe('数据库升级', () => {
  it('从 v1 升到 v2 不会丢掉已有数据', async () => {
    // 造一个只有 v1 结构的数据库（还没有 memos 表）
    await db.close()
    const legacy = new Dexie('savememory')
    legacy.version(1).stores({
      sources: 'id, createdAt, generationStatus',
      concepts: 'id, sourceId, [sourceId+index]',
      cards: 'id, conceptId, sourceId, dueAt, [sourceId+createdAt]',
      reviewLogs: 'id, cardId, conceptId, reviewedAt',
      settings: 'id',
    })
    await legacy.open()
    await legacy.table('sources').put({
      id: 'legacy-source',
      kind: 'text',
      title: '升级前的材料',
      text: '旧内容',
      createdAt: 1,
      generationStatus: 'done',
    })
    await legacy.close()

    // 应用以 v2 打开同一个库
    await db.open()

    const source = await db.sources.get('legacy-source')
    expect(source?.title).toBe('升级前的材料')

    // 新表可以正常使用
    expect(await db.memos.count()).toBe(0)
    await db.memos.put({
      id: 'm1',
      title: '升级后新增',
      content: 'x',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
    })
    expect(await db.memos.count()).toBe(1)
  })
})

describe('备份包含备忘录', () => {
  it('导出与导入都覆盖备忘录', async () => {
    const now = Date.now()
    await memosRepo.put({
      id: 'm1',
      title: '备忘',
      content: '内容',
      createdAt: now,
      updatedAt: now,
      pinned: true,
    })

    const backup = await buildBackup()
    expect(backup.memos).toHaveLength(1)

    await memosRepo.remove('m1')
    expect(await memosRepo.count()).toBe(0)

    const file = new File([JSON.stringify(backup)], 'backup.json', {
      type: 'application/json',
    })
    const counts = await importBackup(file)

    expect(counts.memos).toBe(1)
    const restored = await memosRepo.get('m1')
    expect(restored?.title).toBe('备忘')
    expect(restored?.pinned).toBe(true)
  })

  it('备份保留手写内容', async () => {
    const now = Date.now()
    await memosRepo.put({
      id: 'm1',
      title: '手写备忘',
      content: '',
      handwriting: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }),
      createdAt: now,
      updatedAt: now,
      pinned: false,
    })

    const backup = await buildBackup()
    expect(backup.memos?.[0].handwritingData?.dataUrl).toContain('data:image/png;base64,')

    await memosRepo.remove('m1')

    const file = new File([JSON.stringify(backup)], 'backup.json', {
      type: 'application/json',
    })
    await importBackup(file)

    const restored = await memosRepo.get('m1')
    expect(restored?.handwriting).toBeInstanceOf(Blob)
    expect(restored?.handwriting?.size).toBe(5)
  })
})
