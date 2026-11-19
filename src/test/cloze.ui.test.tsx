// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo, reviewLogsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { createNewCard } from '../fsrs/scheduler'
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

/** Imports a word list through the real UI and starts a study session. */
async function importAndStudy(wordList: string) {
  const user = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: '导入' })

  // Only the forward card, so the session always starts with the cloze.
  await user.click(screen.getByRole('checkbox', { name: /生成双向卡片/ }))

  // The text is pasted, not typed: `[` and `{` are escape characters for
  // user-event's keyboard syntax.
  const textarea = screen.getByLabelText('词表内容')
  fireEvent.change(textarea, { target: { value: wordList } })
  await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))
  await screen.findByText(/已生成 \d+ 张卡片/)

  await user.click(screen.getByRole('button', { name: /学习/ }))
  await user.click(await screen.findByRole('button', { name: '开始学习' }))
  await screen.findByRole('heading', { level: 2 })
  return user
}

describe('填空题的学习流程', () => {
  it('题面把空缺遮成 [...]', async () => {
    await importAndStudy('I [go] to school every day. - 我每天去上学。')

    const prompt = screen.getByRole('heading', { level: 2 })
    expect(prompt.textContent).toBe('I [...] to school every day.')
    // 原文里的空缺内容此时不能出现。
    expect(prompt.textContent).not.toContain('go')
    expect(screen.queryByText('我每天去上学。')).toBeNull()
  })

  it('显示答案后高亮空缺内容，并把译文作为附加提示', async () => {
    const user = await importAndStudy('I [go] to school every day. - 我每天去上学。')

    await user.click(screen.getByRole('button', { name: '显示答案' }))

    const prompt = screen.getByRole('heading', { level: 2 })
    expect(prompt.textContent).toBe('I go to school every day.')

    // 空缺内容被高亮。
    const filled = document.querySelector('.cloze-blank.cloze-filled')
    expect(filled?.textContent).toBe('go')

    // 中文翻译作为附加提示出现。
    expect(screen.getByText('参考译文')).toBeTruthy()
    expect(screen.getByText('我每天去上学。')).toBeTruthy()
  })

  it('填空题也能正常评分并记录', async () => {
    const user = await importAndStudy('I [go] to school every day. - 我每天去上学。')

    await user.click(screen.getByRole('button', { name: '显示答案' }))
    await screen.findByText('参考译文')
    await user.click(screen.getByRole('button', { name: /良好/ }))

    await waitFor(async () => {
      expect(await reviewLogsRepo.count()).toBe(1)
    })
    const logs = await reviewLogsRepo.listRecent(1)
    expect(logs[0].mode).toBe('self')
  })

  it('双向卡片与填空题共存', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })

    const textarea = screen.getByLabelText('词表内容')
    fireEvent.change(textarea, {
      target: { value: 'I [go] to school every day. - 我每天去上学。' },
    })
    await user.click(screen.getByRole('button', { name: '解析并生成卡片' }))
    await screen.findByText(/已生成 2 张卡片（1 个词条）/)

    // 一张填空题 + 一张反向问答。
    expect(await cardsRepo.count()).toBe(2)
  })

  it('普通词条不受影响', async () => {
    await importAndStudy('apple - 苹果')

    const prompt = screen.getByRole('heading', { level: 2 })
    expect(prompt.textContent).toBe('apple')
    expect(document.querySelector('.cloze-blank')).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '显示答案' }))
    expect(await screen.findByText('参考答案')).toBeTruthy()
  })

  it('模型生成的填空题答案就是空缺内容，仍然显示「参考答案」', async () => {
    // 这类卡片的 `answer` 存的是被挖掉的内容本身（见 llm/prompts.ts）。
    const card = await createNewCard(
      { desiredRetention: 0.9, maximumInterval: 36500 },
      'card-cloze-1',
    )
    card.type = 'cloze'
    card.prompt = '目标保持率越高，复习间隔越 {{短}}。'
    card.answer = '短'
    await cardsRepo.put(card)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: /学习/ }))
    await user.click(await screen.findByRole('button', { name: '开始学习' }))
    await screen.findByRole('heading', { level: 2 })

    // 答案揭晓之前，{{短}} 必须被遮住 —— 否则等于直接把答案给了用户。
    const prompt = screen.getByRole('heading', { level: 2 })
    expect(prompt.textContent).toBe('目标保持率越高，复习间隔越 [...]。')
    expect(prompt.textContent).not.toContain('短')

    await user.click(screen.getByRole('button', { name: '显示答案' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
        '目标保持率越高，复习间隔越 短。',
      )
    })
    expect(screen.getByText('参考答案')).toBeTruthy()
    expect(screen.queryByText('参考译文')).toBeNull()
  })
})
