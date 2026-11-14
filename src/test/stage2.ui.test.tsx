// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { seedDemoData } from '../dev/seed'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { FakeProvider } from './fakeProvider'

/**
 * The UI always builds its provider from the settings, so we swap that factory
 * for the fake model. Everything else — the real ingest service, the real
 * FSRS scheduling, the real React flow — runs unmodified.
 */
const mocks = vi.hoisted(() => ({
  provider: undefined as unknown,
}))

vi.mock('../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm')>()
  const { FakeProvider } = await import('./fakeProvider')
  mocks.provider = new FakeProvider({
    imageText: 'TCP 建立连接需要三次握手。',
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
  // The app loads its settings from the database on mount, so persist them
  // there rather than only setting them in the store.
  await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: 'test-key' })
  useSettings.setState({
    settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
    loaded: true,
  })
  useStudy.getState().reset()
  mocks.provider = new FakeProvider({
    imageText: 'TCP 建立连接需要三次握手。',
    judgement: { verdict: 'correct', feedback: '答得很准确。', suggestedRating: 4 },
  })
})

afterEach(() => {
  cleanup()
})

describe('图片上传界面', () => {
  it('选择图片后可以识别并生成卡片', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    // 切换到图片模式
    await user.click(screen.getByRole('button', { name: '图片' }))
    expect(screen.getByText('拖拽图片到这里，或点击选择文件')).toBeTruthy()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'note.png', { type: 'image/png' })
    await user.upload(input, file)

    // 预览出现
    await waitFor(() => {
      expect(screen.getByAltText('待识别的图片')).toBeTruthy()
    })

    const button = screen.getByRole('button', { name: '识别图片并生成卡片' })
    expect((button as HTMLButtonElement).disabled).toBe(false)

    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText(/已从图片生成/)).toBeTruthy()
    })
  })

  it('模型读不了图时展示原图并允许手动补录文字', async () => {
    mocks.provider = new FakeProvider({ failVision: true })

    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '图片' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'note.png', { type: 'image/png' }),
    )

    await waitFor(() => {
      expect(screen.getByAltText('待识别的图片')).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: '识别图片并生成卡片' }))

    // 兜底 UI 出现：提示 + 原图 + 文本框
    expect(await screen.findByText('手动补录图片文字')).toBeTruthy()
    expect(await screen.findByAltText('原图')).toBeTruthy()

    const textarea = screen.getByPlaceholderText('对照图片，把文字抄录或粘贴到这里…')
    await user.type(textarea, 'TCP 建立连接需要三次握手。')

    await user.click(screen.getByRole('button', { name: '用这段文字继续生成' }))

    await waitFor(() => {
      expect(screen.getByText(/已根据手动输入的文字生成/)).toBeTruthy()
    })
  })
})

describe('AI 评判界面', () => {
  it('提交答案后展示反馈并高亮建议档位', async () => {
    await seedDemoData()

    await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: 'test-key', gradingMode: 'ai' })

    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    // 只显示题干，答案不可见
    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText('参考答案')).toBeNull()

    const textarea = screen.getByPlaceholderText('写下你记得的答案，AI 会对照参考答案给出评级…')
    await user.type(textarea, '三次握手')

    await user.click(screen.getByRole('button', { name: '提交答案' }))

    // AI 反馈与判定
    expect(await screen.findByText('AI 判定：正确')).toBeTruthy()
    expect(screen.getByText('答得很准确。')).toBeTruthy()

    // 参考答案此时才出现
    expect(screen.getByText('参考答案')).toBeTruthy()

    // 建议档位被高亮
    const suggested = screen.getByRole('button', { name: /简单/ })
    expect(suggested.className).toContain('suggested')
    expect(screen.getByText('AI 建议')).toBeTruthy()

    // 采用建议后进入下一张
    await user.click(suggested)
    await waitFor(() => {
      expect(screen.getByText(/进度 2 \//)).toBeTruthy()
    })
  })

  it('用户可以改选其它档位', async () => {
    await seedDemoData()

    await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: 'test-key', gradingMode: 'ai' })

    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })
    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    await screen.findByRole('heading', { level: 2 })
    await user.type(screen.getByPlaceholderText('写下你记得的答案，AI 会对照参考答案给出评级…'), '答案')
    await user.click(screen.getByRole('button', { name: '提交答案' }))

    await screen.findByText('AI 判定：正确')

    // 建议是「简单」，但用户改选「重来」
    await user.click(screen.getByRole('button', { name: /重来/ }))

    // 答错后先问归因原因
    expect(await screen.findByText('这道题为什么没记住？')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /混淆了/ }))

    await waitFor(() => {
      expect(screen.getByText(/进度 2 \//)).toBeTruthy()
    })
  })

  it('手动自评模式下仍然是「我已回忆，显示答案」', async () => {
    await seedDemoData()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '输入材料' })
    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    await screen.findByRole('heading', { level: 2 })
    expect(screen.getByRole('button', { name: '我已回忆，显示答案' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '提交答案' })).toBeNull()
  })
})
