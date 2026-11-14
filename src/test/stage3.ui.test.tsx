// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
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
  await settingsRepo.put({
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
    questionTypes: ['choice'],
  })
  useSettings.setState({
    settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', questionTypes: ['choice'] },
    loaded: true,
  })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('单选题的界面流程', () => {
  it('选择选项后展示答案并给出档位建议', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    // 生成一批选择题
    await user.type(
      screen.getByPlaceholderText('在这里粘贴要记忆的材料…'),
      'TCP 建立连接需要三次握手。进程是资源分配的基本单位。目标保持率是回忆的概率。',
    )
    await user.click(screen.getByRole('button', { name: '生成概念与卡片' }))
    await waitFor(() => {
      expect(screen.getByText(/已生成 \d+ 个原子概念/)).toBeTruthy()
    })

    // 去学习
    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    // 单选题直接展示选项，不出现自由文本框
    await screen.findByRole('heading', { level: 2 })
    expect(screen.getByRole('button', { name: /的正确说法/ })).toBeTruthy()
    expect(screen.queryByPlaceholderText('先试着回忆，写下你想到的答案…')).toBeNull()

    // 答案在选择之前不可见
    expect(screen.queryByText('参考答案')).toBeNull()

    // 选择一个选项后揭晓答案
    await user.click(screen.getByRole('button', { name: /的正确说法/ }))
    expect(await screen.findByText('参考答案')).toBeTruthy()

    // 给出档位建议，用户可以改选
    const gradeButtons = screen.getByRole('button', { name: /良好/ })
    expect(gradeButtons.className).toContain('suggested')

    await user.click(gradeButtons)
    await waitFor(() => {
      expect(screen.getByText(/进度 2 \//)).toBeTruthy()
    })
  })
})
