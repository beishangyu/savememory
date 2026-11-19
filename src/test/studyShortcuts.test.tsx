// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { reviewLogsRepo, settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { seedDemoData } from '../dev/seed'
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

/** Opens the study session and waits for the first card. */
async function startSession() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: '导入' })
  await user.click(screen.getByRole('button', { name: /学习/ }))
  await user.click(await screen.findByRole('button', { name: '开始学习' }))
  await screen.findByRole('heading', { level: 2 })
  return user
}

/** Builds a TouchEvent-ish object for React's touch handlers. */
function touchEvent(type: 'start' | 'move' | 'end', x: number, y: number) {
  const touch = { clientX: x, clientY: y, identifier: 0, target: null }
  if (type === 'end') {
    return {
      touches: [],
      changedTouches: [touch],
      preventDefault: () => {},
    }
  }
  return {
    touches: [touch],
    changedTouches: [touch],
    preventDefault: () => {},
  }
}

describe('键盘快捷键', () => {
  it('空格键显示答案', async () => {
    await seedDemoData()
    await startSession()

    expect(screen.queryByText('参考答案')).toBeNull()

    await userEvent.keyboard(' ')

    expect(await screen.findByText('参考答案')).toBeTruthy()
  })

  it('数字键 1-4 对应四档评分', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    await userEvent.keyboard('3')

    await waitFor(async () => {
      expect(await reviewLogsRepo.count()).toBe(1)
    })
    const logs = await reviewLogsRepo.listRecent(1)
    // FSRS rating 3 = Good.
    expect(logs[0].rating).toBe(3)
    expect(logs[0].mode).toBe('self')
  })

  it('未显示答案时数字键不评分', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard('3')

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await reviewLogsRepo.count()).toBe(0)
    expect(screen.queryByText('参考答案')).toBeNull()
  })

  it('在输入框里打字不会触发快捷键', async () => {
    await seedDemoData()
    // AI 评判是两步开关：先在设置里打开总开关，学习页才会出现切换按钮。
    await settingsRepo.put({ ...DEFAULT_SETTINGS, apiKey: '', gradingMode: 'ai' })
    useSettings.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', gradingMode: 'ai' },
      loaded: true,
    })
    const user = await startSession()

    // 开启实验性 AI 评判，出现输入框。
    await user.click(screen.getByRole('button', { name: '实验性：用 AI 评判我的作答' }))
    const textarea = await screen.findByPlaceholderText(
      '写下你记得的答案，AI 会对照参考答案给出评级…',
    )

    await user.type(textarea, '1234')

    // 没有评分发生，输入框里仍是用户输入的内容。
    expect(await reviewLogsRepo.count()).toBe(0)
    expect((textarea as HTMLTextAreaElement).value).toBe('1234')
  })

  it('评分按钮下方标注了快捷键', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    for (const [key, label] of [
      ['1', 'Again'],
      ['2', 'Hard'],
      ['3', 'Good'],
      ['4', 'Easy'],
    ]) {
      expect(screen.getByText(`${key} - ${label}`)).toBeTruthy()
    }
  })

  it('评分按钮声明了对应的快捷键', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    for (const [key, label] of [
      ['1', '重来'],
      ['2', '困难'],
      ['3', '良好'],
      ['4', '简单'],
    ]) {
      const button = screen.getByRole('button', { name: new RegExp(label) })
      expect(button.getAttribute('aria-keyshortcuts')).toBe(key)
    }
  })
})

describe('触屏手势', () => {
  it('向左滑表示重来', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 300, 400))
    fireEvent.touchMove(panel, touchEvent('move', 200, 410))
    fireEvent.touchEnd(panel, touchEvent('end', 200, 410))

    await waitFor(async () => {
      expect(await reviewLogsRepo.count()).toBe(1)
    })
    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].rating).toBe(1) // Again
  })

  it('向右滑表示良好', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 100, 400))
    fireEvent.touchMove(panel, touchEvent('move', 220, 395))
    fireEvent.touchEnd(panel, touchEvent('end', 220, 395))

    await waitFor(async () => {
      expect(await reviewLogsRepo.count()).toBe(1)
    })
    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].rating).toBe(3) // Good
  })

  it('未显示答案时滑动不评分', async () => {
    await seedDemoData()
    await startSession()

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 300, 400))
    fireEvent.touchEnd(panel, touchEvent('end', 150, 400))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await reviewLogsRepo.count()).toBe(0)
  })

  it('距离太近的滑动被忽略', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 300, 400))
    fireEvent.touchEnd(panel, touchEvent('end', 285, 400))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await reviewLogsRepo.count()).toBe(0)
  })

  it('竖直滑动不会评分', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 300, 200))
    fireEvent.touchMove(panel, touchEvent('move', 290, 400))
    fireEvent.touchEnd(panel, touchEvent('end', 290, 400))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await reviewLogsRepo.count()).toBe(0)
  })

  it('在画布上滑动不会评分', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    // 模拟手写画布上的触摸（目标元素是 canvas）。
    const canvas = document.createElement('canvas')
    const panel = document.querySelector('.card-panel') as HTMLElement
    panel.appendChild(canvas)

    fireEvent.touchStart(canvas, touchEvent('start', 300, 400))
    fireEvent.touchMove(canvas, touchEvent('move', 200, 405))
    fireEvent.touchEnd(canvas, touchEvent('end', 200, 405))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await reviewLogsRepo.count()).toBe(0)
  })

  it('滑动过程中给出方向提示', async () => {
    await seedDemoData()
    await startSession()

    await userEvent.keyboard(' ')
    await screen.findByText('参考答案')

    const panel = document.querySelector('.card-panel') as HTMLElement
    fireEvent.touchStart(panel, touchEvent('start', 300, 400))
    fireEvent.touchMove(panel, touchEvent('move', 200, 405))

    expect(await screen.findByText('← 重来')).toBeTruthy()

    fireEvent.touchMove(panel, touchEvent('move', 400, 405))
    expect(await screen.findByText('良好 →')).toBeTruthy()

    fireEvent.touchEnd(panel, touchEvent('end', 400, 405))
    await waitFor(() => {
      expect(screen.queryByText('良好 →')).toBeNull()
    })
  })
})
