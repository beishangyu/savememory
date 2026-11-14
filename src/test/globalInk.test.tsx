// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useInk } from '../store/ink'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

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

describe('全局手写', () => {
  it('默认关闭，点击按钮后开启，覆盖层出现在每一页', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    // 默认没有覆盖层
    expect(screen.queryByLabelText('全局手写区域')).toBeNull()

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))

    expect(await screen.findByLabelText('全局手写区域')).toBeTruthy()

    // 切到别的页面，覆盖层依然存在
    await user.click(screen.getByRole('button', { name: '备忘' }))
    await screen.findByRole('heading', { name: '备忘录' })
    expect(screen.getByLabelText('全局手写区域')).toBeTruthy()
  })

  it('全局手写只认手写笔：手指不落笔，页面手势不被锁定', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))
    const overlay = await screen.findByLabelText('全局手写区域')

    // 画布不拦截任何指针事件 —— 页面保留原生焦点行为
    expect(overlay.style.pointerEvents).toBe('none')

    // 页面被锁定：笔无法拖动页面，手掌也无法启动手势抢走笔
    expect(document.documentElement.style.touchAction).toBe('none')

    // 模式切换按钮已移除 —— 全局手写固定为「仅手写笔」
    expect(screen.queryByRole('button', { name: '仅手写笔' })).toBeNull()
    expect(screen.getByText(/仅手写笔可书写/)).toBeTruthy()
  })

  it('开启覆盖层后仍然可以在输入框里正常输入', async () => {
    // Regression: the overlay used to call preventDefault() on pointerdown,
    // which cancelled the browser's default focus behaviour and left every
    // input in the app unfocusable.
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))
    await screen.findByLabelText('全局手写区域')

    await user.click(screen.getByRole('button', { name: '备忘' }))
    await screen.findByRole('heading', { name: '备忘录' })
    await user.click(screen.getByRole('button', { name: /写一条/ }))

    const title = screen.getByPlaceholderText('一句话概括这条备忘') as HTMLInputElement
    await user.type(title, '输入得进去')
    expect(title.value).toBe('输入得进去')

    const content = screen.getByPlaceholderText('想到什么就写什么…') as HTMLTextAreaElement
    await user.type(content, '内容也进得去')
    expect(content.value).toBe('内容也进得去')
  })

  it('全局手写只认手写笔：手指和鼠标都不落笔', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))
    await screen.findByLabelText('全局手写区域')

    const undo = screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement
    expect(undo.disabled).toBe(true)

    const stroke = (pointerType: string, pointerId: number) => {
      act(() => {
        for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
          const event = new Event(type, { bubbles: true, cancelable: true })
          // jsdom has no PointerEvent constructor, so the extra properties have
          // to be attached by hand.
          Object.defineProperties(event, {
            pointerType: { value: pointerType },
            pointerId: { value: pointerId },
            clientX: { value: 10 },
            clientY: { value: 10 },
            pressure: { value: 0.5 },
            timeStamp: { value: Date.now() },
          })
          document.body.dispatchEvent(event)
        }
      })
    }

    // 手指：被拒绝，不产生任何笔画
    stroke('touch', 1)
    expect(undo.disabled).toBe(true)

    // 鼠标：全局手写只支持手写笔，鼠标也不画
    stroke('mouse', 2)
    expect(undo.disabled).toBe(true)

    // 笔：正常落笔
    stroke('pen', 3)
    expect(undo.disabled).toBe(false)
  })

  it('画布在打开时被正确调整到视口大小', async () => {
    // Regression: the overlay's canvas is mounted long after the hook runs.
    // If it is not resized on attach it keeps the default 300x150 backing
    // store, and every stroke outside that area is invisible.
    const rect = {
      width: 1024,
      height: 768,
      top: 0,
      left: 0,
      right: 1024,
      bottom: 768,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect

    try {
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('heading', { name: '输入材料' })

      await user.click(screen.getByRole('button', { name: '打开全局手写' }))
      const overlay = (await screen.findByLabelText('全局手写区域')) as HTMLCanvasElement

      expect(overlay.width).toBe(1024)
      expect(overlay.height).toBe(768)
      expect(screen.getByText('画布：1024×768')).toBeTruthy()
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })

  it('可以选择墨色与压感强度，并持久化到设置', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))
    await screen.findByLabelText('全局手写区域')

    // 选一个墨色
    const yellow = screen.getByRole('button', { name: '墨色 #ffd43b' })
    await user.click(yellow)
    expect(useInk.getState().color).toBe('#ffd43b')
    expect(yellow.getAttribute('aria-pressed')).toBe('true')

    // 调压感强度
    const slider = screen.getByLabelText('压感强度') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '40' } })
    expect(useInk.getState().pressureStrength).toBeCloseTo(0.4)

    // 设置被持久化
    await waitFor(() => {
      expect(useSettings.getState().settings.inkColor).toBe('#ffd43b')
      expect(useSettings.getState().settings.inkPressure).toBeCloseTo(0.4)
    })
  })

  it('工具栏提供撤销 / 清空 / 保存 / 关闭', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '输入材料' })

    await user.click(screen.getByRole('button', { name: '打开全局手写' }))
    await screen.findByLabelText('全局手写区域')

    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()

    // 关闭后覆盖层消失
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await waitForElement(() => screen.queryByLabelText('全局手写区域') === null)
  })
})

async function waitForElement(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待超时')
}
