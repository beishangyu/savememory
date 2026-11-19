// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { FakeProvider } from './fakeProvider'

/**
 * The provider is swapped for the fake model so we can inspect exactly what
 * the app sends to the LLM.
 */
const mocks = vi.hoisted(() => ({
  provider: undefined as unknown,
}))

vi.mock('../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm')>()
  const { FakeProvider } = await import('./fakeProvider')
  mocks.provider = new FakeProvider({
    judgement: { verdict: 'correct', feedback: '答得很准确。', suggestedRating: 4 },
  })
  return {
    ...actual,
    providerFromSettings: () => mocks.provider,
    visionProviderFromSettings: () => mocks.provider,
  }
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: 'test-key', gradingMode: 'ai' })
  useSettings.setState({
    settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', gradingMode: 'ai' },
    loaded: true,
  })
  useStudy.getState().reset()
  mocks.provider = new FakeProvider({
    judgement: { verdict: 'correct', feedback: '答得很准确。', suggestedRating: 4 },
  })
})

afterEach(() => {
  cleanup()
})

describe('填空题的 AI 评判', () => {
  it('发给模型的是遮住答案的题面', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })

    // 只保留正向的那张填空题。
    await user.click(screen.getByRole('checkbox', { name: /生成双向卡片/ }))

    const textarea = screen.getByLabelText('词表内容')
    fireEvent.change(textarea, {
      target: { value: 'I [go] to school every day. - 我每天去上学。' },
    })
    await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))
    await screen.findByText(/已生成 1 张卡片/)

    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))
    await screen.findByRole('heading', { level: 2 })

    // 开启实验性 AI 评判。
    await user.click(screen.getByRole('button', { name: '实验性：用 AI 评判我的作答' }))
    const input = await screen.findByPlaceholderText(
      '写下你记得的答案，AI 会对照参考答案给出评级…',
    )
    await user.type(input, 'go')
    await user.click(screen.getByRole('button', { name: '提交答案' }))

    await waitFor(() => {
      expect((mocks.provider as FakeProvider).prompts.length).toBeGreaterThan(0)
    })

    const judgePrompt = (mocks.provider as FakeProvider).prompts.at(-1) ?? ''
    // 题面是遮住的，模型看不到答案。
    expect(judgePrompt).toContain('I [...] to school every day.')
    expect(judgePrompt).not.toContain('I [go] to school')
    // 参考答案是空缺处本身。
    expect(judgePrompt).toContain('参考答案：go')
  })
})
