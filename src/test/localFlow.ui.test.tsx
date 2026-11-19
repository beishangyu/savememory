// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

/**
 * The product promise: with no API Key configured at all, the app still works
 * end to end — paste a word list, get cards, review them.
 */
beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: '' }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('零 API Key 的本地流程', () => {
  it('粘贴词表即可生成卡片，全程没有报错', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })

    // AI 面板默认收起，主流程只有本地词表。
    expect(screen.queryByRole('button', { name: '识别图片并生成卡片' })).toBeNull()

    const textarea = screen.getByLabelText('词表内容')
    await user.type(textarea, 'apple - 苹果')
    await user.type(textarea, '\nbanana - 香蕉')

    // 实时预览告诉用户识别了几条。
    expect(screen.getByText(/已识别 2 条/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))

    expect(await screen.findByText(/已生成 4 张卡片（2 个词条）/)).toBeTruthy()
    // 页面上没有任何错误提示 —— 也不需要填 API Key。
    expect(document.querySelector('.alert-error')).toBeNull()

    // 双向默认开启 → 2 个词条 × 2 张卡。
    expect(await cardsRepo.count()).toBe(4)
  })

  it('关闭双向后每个词条只生成一张卡', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })

    await user.click(screen.getByRole('checkbox', { name: /生成双向卡片/ }))

    const textarea = screen.getByLabelText('词表内容')
    await user.type(textarea, 'apple - 苹果')

    await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))

    expect(await screen.findByText(/已生成 1 张卡片（1 个词条）/)).toBeTruthy()
    expect(await cardsRepo.count()).toBe(1)
  })

  it('导入的卡片可以直接进入学习页，并按 mode=self 记录', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })

    const textarea = screen.getByLabelText('词表内容')
    await user.type(textarea, 'apple - 苹果')
    await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))
    await screen.findByText(/已生成 2 张卡片（1 个词条）/)

    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    // 默认是经典闪卡流程：没有输入框，只有「显示答案」。
    await screen.findByRole('heading', { level: 2 })
    expect(
      screen.queryByPlaceholderText('写下你记得的答案，AI 会对照参考答案给出评级…'),
    ).toBeNull()
    expect(screen.getByRole('button', { name: '显示答案' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '显示答案' }))
    expect(await screen.findByText('参考答案')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /良好/ }))

    await waitFor(async () => {
      expect(await reviewLogsRepo.count()).toBe(1)
    })
    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].mode).toBe('self')
    expect(logs[0].aiVerdict).toBeUndefined()
  })
})
