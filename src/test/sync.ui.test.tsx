// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { cardsRepo } from '../db/repo'
import { DEFAULT_SETTINGS } from '../db/schema'
import { useSettings } from '../store/settings'
import { useStudy } from '../store/study'
import { collectBundle, serializeBundle } from '../services/sync'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  useStudy.getState().reset()
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
})

describe('扫码同步', () => {
  it('在设置页生成二维码', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '设置' }))

    expect(await screen.findByRole('heading', { name: '扫码同步' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '生成二维码' }))

    await waitFor(() => {
      expect(document.querySelector('svg.qr-code')).toBeTruthy()
    })
    expect(document.querySelector('svg.qr-code')?.getAttribute('aria-label')).toBeTruthy()
  })

  it('把同步文本合并到本机', async () => {
    // 先造一份数据，再序列化出来。
    const bundle = await collectBundle('full')
    const text = await serializeBundle(bundle)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '导入' })
    await user.click(screen.getByRole('button', { name: '设置' }))
    await screen.findByRole('heading', { name: '扫码同步' })

    await user.click(screen.getByText('从同步文本恢复'))
    const textarea = screen.getByPlaceholderText(/粘贴以 SM1: 开头的同步文本/)
    await user.type(textarea, text)

    await user.click(screen.getByRole('button', { name: '合并到本机' }))

    await waitFor(() => {
      expect(screen.getByText(/已合并/)).toBeTruthy()
    })
    expect(document.querySelector('.alert-error')).toBeNull()
    expect(await cardsRepo.count()).toBe(0)
  })

  it('扫描带数据的链接后自动带到导入框', async () => {
    const bundle = await collectBundle('full')
    const text = await serializeBundle(bundle)
    window.location.hash = `#sync=${text}`

    render(<App />)

    // 带链接打开时会直接落到设置页。
    expect(await screen.findByRole('heading', { name: '扫码同步' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/粘贴以 SM1: 开头的同步文本/)).toBeTruthy()
    })
    expect(screen.getByText(/检测到扫码带过来的同步数据/)).toBeTruthy()
  })
})
