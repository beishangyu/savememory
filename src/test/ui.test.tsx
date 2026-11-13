// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo } from '../db/repo'
import { seedDemoData } from '../dev/seed'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { DEFAULT_SETTINGS } from '../db/schema'

afterEach(() => {
  cleanup()
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' }, loaded: true })
  useStudy.getState().reset()
})

describe('界面流程', () => {
  it('默认进入输入页面', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '输入材料' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '学习' })).toBeTruthy()
  })

  it('学习流程：先回忆 → 显示答案 → 四档自评', async () => {
    await seedDemoData()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '输入材料' })

    // 进入学习页
    await user.click(screen.getByRole('button', { name: /学习/ }))

    // 到期卡片数量
    const dueText = await screen.findByText('张卡片已到期')
    expect(dueText).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '开始学习' }))

    // 关键：答案在回忆之前不可见
    const prompt = await screen.findByRole('heading', { level: 2 })
    expect(prompt.textContent).toBeTruthy()
    expect(screen.queryByText('参考答案')).toBeNull()
    expect(screen.queryByText('良好')).toBeNull()

    // 先尝试回忆
    const textarea = screen.getByPlaceholderText('先试着回忆，写下你想到的答案…')
    await user.type(textarea, '三次握手')
    expect((textarea as HTMLTextAreaElement).value).toBe('三次握手')

    // 揭示答案
    await user.click(screen.getByRole('button', { name: '我已回忆，显示答案' }))
    expect(await screen.findByText('参考答案')).toBeTruthy()

    // 四档评分按钮
    for (const label of ['重来', '困难', '良好', '简单']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }

    await user.click(screen.getByRole('button', { name: /良好/ }))

    // 进入下一张卡
    await waitFor(() => {
      expect(screen.getByText(/进度 2 \//)).toBeTruthy()
    })
  })

  it('答错后卡片排到会话末尾再次出现', async () => {
    await seedDemoData()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '输入材料' })
    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))

    await screen.findByRole('heading', { level: 2 })
    await user.click(screen.getByRole('button', { name: '我已回忆，显示答案' }))
    await screen.findByText('参考答案')
    await user.click(screen.getByRole('button', { name: /重来/ }))

    // 队列变长：总卡片数 + 1
    await waitFor(() => {
      expect(screen.getByText(/进度 2 \/ 8/)).toBeTruthy()
    })
  })

  it('刷新页面后数据仍在', async () => {
    await seedDemoData()
    const before = await cardsRepo.count()
    expect(before).toBeGreaterThan(0)

    const first = render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })
    first.unmount()

    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    const after = await cardsRepo.count()
    expect(after).toBe(before)
  })

  it('卡片库页面展示材料、概念与卡片', async () => {
    await seedDemoData()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '输入材料' })
    await user.click(screen.getByRole('button', { name: '卡片库' }))

    expect(await screen.findByRole('heading', { name: '卡片库' })).toBeTruthy()
    expect(await screen.findByText('演示材料 · 计算机基础')).toBeTruthy()

    const meta = document.querySelector('.source-meta')
    expect(meta?.textContent).toContain('3 个概念')
    expect(meta?.textContent).toContain('7 张卡片')
  })

  it('窄屏时改用底部 Tab Bar，宽屏时用顶部导航', async () => {
    const original = window.matchMedia
    const setPhone = (isPhone: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: isPhone && query.includes('767'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
    }

    try {
      // 宽屏：顶部导航
      setPhone(false)
      const desktop = render(<App />)
      await screen.findByRole('heading', { name: '输入材料' })
      expect(screen.getByRole('button', { name: '学习' })).toBeTruthy()
      expect(document.querySelector('.topbar')).toBeTruthy()
      expect(document.querySelector('.tabbar')).toBeNull()
      desktop.unmount()

      // 窄屏：底部 Tab Bar，且不再出现重复的顶部导航
      setPhone(true)
      render(<App />)
      await screen.findByRole('heading', { name: '输入材料' })

      const tabbar = document.querySelector('.tabbar')
      expect(tabbar).toBeTruthy()
      expect(document.querySelector('.topbar')).toBeNull()
      expect(screen.getAllByRole('button', { name: '学习' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: '卡片库' })).toHaveLength(1)
    } finally {
      window.matchMedia = original
    }
  })
})
