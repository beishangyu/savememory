// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

/** 导入几千张卡片要花点时间。 */
const WAIT = { timeout: 30000 }
const TIMEOUT = 60000

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, apiKey: '' }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

/** The 内置词库 panel — scoped, because the nav tab is called 「导入」 too. */
function panel() {
  const heading = screen.getByRole('heading', { name: '内置词库' })
  const section = heading.closest('section')
  if (!section) throw new Error('找不到内置词库面板')
  return within(section as HTMLElement)
}

describe('内置词库面板', () => {
  it('列出三份词表并能预览', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    expect(await screen.findByRole('heading', { name: '内置词库' })).toBeTruthy()

    expect(screen.getByText('大学英语四级核心词汇')).toBeTruthy()
    expect(screen.getByText('大学英语六级核心词汇')).toBeTruthy()
    expect(screen.getByText('考研英语核心词汇')).toBeTruthy()

    // 预览会读出词表并显示前几个词条。
    await user.click(panel().getAllByRole('button', { name: '预览' })[0])

    await waitFor(() => {
      expect(document.querySelector('.builtin-preview')).toBeTruthy()
    })
    expect(document.querySelector('.builtin-preview')?.textContent).toMatch(/ - /)
  }, TIMEOUT)

  it('默认生成卡片', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await screen.findByRole('heading', { name: '内置词库' })

    await user.click(panel().getAllByRole('button', { name: '导入' })[0])

    await waitFor(async () => {
      expect(await cardsRepo.count()).toBeGreaterThan(0)
    }, WAIT)
    expect(await db.sources.count()).toBe(1)
    expect(await db.concepts.count()).toBeGreaterThan(0)
    expect(panel().getByText(/已导入/)).toBeTruthy()
  }, TIMEOUT)

  it('取消勾选后只保存词表，不生成卡片', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await screen.findByRole('heading', { name: '内置词库' })

    await user.click(panel().getByRole('checkbox', { name: '导入后生成卡片' }))

    await user.click(panel().getAllByRole('button', { name: '导入' })[0])

    await waitFor(async () => {
      expect(await db.sources.count()).toBe(1)
    }, WAIT)
    // 没有卡片，也没有概念 —— 只是把词表当材料存下来。
    expect(await cardsRepo.count()).toBe(0)
    expect(await db.concepts.count()).toBe(0)
    expect(panel().getByText(/没有生成卡片/)).toBeTruthy()
  }, TIMEOUT)

  it('同一个词表不会重复导入', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await screen.findByRole('heading', { name: '内置词库' })

    await user.click(panel().getAllByRole('button', { name: '导入' })[0])
    // 等导入真正结束（按钮重新可用），再点第二次。
    await waitFor(() => {
      expect(panel().getByText(/已导入/)).toBeTruthy()
    }, WAIT)

    await user.click(panel().getAllByRole('button', { name: '导入' })[0])
    await waitFor(() => {
      expect(panel().getByText(/已经导入过了/)).toBeTruthy()
    })
    expect(await db.sources.count()).toBe(1)
  }, TIMEOUT)
})
