// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { createNewCard } from '../fsrs/scheduler'
import { uid } from '../lib/id'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'

const MS_PER_DAY = 86_400_000

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  useStudy.getState().reset()
})

afterEach(() => {
  cleanup()
})

async function seedActivity() {
  const now = Date.now()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const card = await createNewCard(
    { desiredRetention: 0.9, maximumInterval: 36500 },
    uid('card'),
  )
  card.prompt = '题'
  card.answer = '答'
  await cardsRepo.put(card)

  for (const offset of [0, 1, 2]) {
    await reviewLogsRepo.put({
      id: uid('log'),
      cardId: card.id,
      conceptId: 'con-1',
      rating: 3,
      reviewedAt: today.getTime() + offset * MS_PER_DAY + 3_600_000,
      dueAt: today.getTime() + (offset + 1) * MS_PER_DAY,
      state: 2,
      elapsedDays: 0,
      scheduledDays: 1,
      durationMs: 1000,
      mode: 'self',
    })
  }
  return card
}

describe('统计页', () => {
  it('展示概览数字', async () => {
    await seedActivity()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '统计' }))

    expect(await screen.findByRole('heading', { name: '统计' })).toBeTruthy()
    expect(screen.getByText('今日待复习')).toBeTruthy()
    expect(screen.getByText('今日已复习')).toBeTruthy()
    expect(screen.getByText('总卡片数')).toBeTruthy()
    expect(screen.getByText('总复习次数')).toBeTruthy()

    /** The number inside a stat tile. */
    const tileValue = (label: string) =>
      screen.getByText(label).parentElement?.querySelector('.stat-value')?.textContent

    await waitFor(() => {
      // 三条复习记录，其中一条是今天。
      expect(tileValue('总复习次数')).toBe('3')
      expect(tileValue('总卡片数')).toBe('1')
      expect(tileValue('今日已复习')).toBe('1')
      expect(tileValue('今日待复习')).toBe('1')
    })
  })

  it('渲染 53 周 × 7 天的热力图', async () => {
    await seedActivity()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '统计' }))

    await screen.findByRole('heading', { name: '统计' })
    await waitFor(() => {
      expect(document.querySelectorAll('.heat-cell').length).toBeGreaterThanOrEqual(53 * 7)
    })
  })

  it('渲染未来 7 天的预测柱状图', async () => {
    await seedActivity()
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '统计' }))

    await screen.findByRole('heading', { name: '统计' })
    await waitFor(() => {
      expect(document.querySelectorAll('.forecast-col')).toHaveLength(7)
    })
    // 只有预计量大于 0 的日子才画柱子。
    const bars = document.querySelectorAll('.forecast-bar')
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.length).toBeLessThanOrEqual(7)
    expect(screen.getByText('今天')).toBeTruthy()
  })

  it('空数据时也能正常显示', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '统计' }))

    await screen.findByRole('heading', { name: '统计' })
    await waitFor(() => {
      expect(document.querySelectorAll('.forecast-col')).toHaveLength(7)
    })
    expect(document.querySelector('.alert-error')).toBeNull()
  })
})
