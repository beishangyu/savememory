// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { seedDemoData } from '../dev/seed'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

vi.mock('../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm')>()
  const { FakeProvider } = await import('./fakeProvider')
  const provider = new FakeProvider({
    judgement: { verdict: 'correct', feedback: '答得很准确。', suggestedRating: 4 },
  })
  return {
    ...actual,
    providerFromSettings: () => provider,
    visionProviderFromSettings: () => provider,
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
})

afterEach(() => {
  cleanup()
})

describe('手写笔输入', () => {
  it('AI 评判模式下可以切换到手写', async () => {
    await seedDemoData()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))
    await screen.findByRole('heading', { level: 2 })

    // 默认是键盘输入
    expect(screen.getByPlaceholderText('写下你记得的答案，AI 会对照参考答案给出评级…')).toBeTruthy()
    expect(screen.queryByLabelText('手写区域')).toBeNull()

    // 切到手写
    await user.click(screen.getByRole('button', { name: '手写笔' }))

    expect(await screen.findByLabelText('手写区域')).toBeTruthy()
    expect(screen.queryByPlaceholderText('写下你记得的答案，AI 会对照参考答案给出评级…')).toBeNull()

    // 手写区带撤销 / 清空 / 防误触控制
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /自动/ })).toBeTruthy()
  })

  it('备忘录页可以切换到手写', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '备忘' }))
    await screen.findByRole('heading', { name: '备忘录' })

    await user.click(screen.getByRole('button', { name: /写一条/ }))
    expect(screen.getByPlaceholderText('想到什么就写什么…')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '手写笔' }))

    expect(await screen.findByLabelText('手写区域')).toBeTruthy()
    expect(screen.queryByPlaceholderText('想到什么就写什么…')).toBeNull()
  })
})
