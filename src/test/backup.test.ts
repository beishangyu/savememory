import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { settingsRepo } from '../db/repo'
import { DEFAULT_SETTINGS, type Settings } from '../db/schema'
import { buildBackup, importBackup } from '../services/backup'
import { createImageSource, createTextSource, generateForSource } from '../services/ingest'
import { FakeProvider } from './fakeProvider'

const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: 'super-secret-key' }

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('导出数据', () => {
  it('包含所有表的数据', async () => {
    const source = await createTextSource('材料内容', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())

    const backup = await buildBackup()

    expect(backup.format).toBe('savememory-backup')
    expect(backup.sources).toHaveLength(1)
    expect(backup.concepts).toHaveLength(3)
    expect(backup.cards).toHaveLength(6)
    expect(backup.reviewLogs).toHaveLength(0)
  })

  it('剔除 API Key', async () => {
    await settingsRepo.put(settings)
    const backup = await buildBackup()

    expect(backup.settings?.apiKey).toBe('')
    expect(backup.apiKeyIncluded).toBe(false)
    expect(JSON.stringify(backup)).not.toContain('super-secret-key')
  })

  it('图片以 data URL 形式保存', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const source = await createImageSource(blob, '图片材料', 'image/png')

    const backup = await buildBackup()
    const exported = backup.sources.find((item) => item.id === source.id)

    expect(exported?.imageData).toBeTruthy()
    expect(exported?.imageData?.dataUrl).toContain('data:image/png;base64,')
  })
})

describe('导入数据', () => {
  it('完整恢复材料、概念、卡片与图片', async () => {
    const source = await createTextSource('材料内容', '测试材料')
    await generateForSource(source.id, settings, new FakeProvider())

    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    const imageSource = await createImageSource(blob, '图片材料', 'image/png')

    const backup = await buildBackup()
    const file = new File([JSON.stringify(backup)], 'backup.json', {
      type: 'application/json',
    })

    // 清空后恢复
    await db.sources.clear()
    await db.concepts.clear()
    await db.cards.clear()

    const counts = await importBackup(file)

    expect(counts.sources).toBe(2)
    expect(counts.concepts).toBe(3)
    expect(counts.cards).toBe(6)

    const restored = await db.sources.get(imageSource.id)
    expect(restored?.kind).toBe('image')
    expect(restored?.image).toBeInstanceOf(Blob)
    expect(restored?.image?.size).toBe(3)
  })

  it('恢复时保留本地的 API Key', async () => {
    await settingsRepo.put(settings)
    const backup = await buildBackup()
    const file = new File([JSON.stringify(backup)], 'backup.json', {
      type: 'application/json',
    })

    await importBackup(file)

    const restored = await settingsRepo.get()
    expect(restored.apiKey).toBe('super-secret-key')
    expect(restored.model).toBe(settings.model)
  })

  it('拒绝非法 JSON 并给出可读错误', async () => {
    const file = new File(['这不是 JSON'], 'broken.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/不是合法的 JSON/)
  })

  it('拒绝格式错误的备份文件', async () => {
    const file = new File(
      [JSON.stringify({ format: 'something-else', version: 1 })],
      'wrong.json',
      { type: 'application/json' },
    )
    await expect(importBackup(file)).rejects.toThrow(/格式不正确/)
  })

  it('导入后旧数据被覆盖', async () => {
    await createTextSource('旧材料', '旧')

    const backup = await buildBackup()
    const file = new File([JSON.stringify(backup)], 'backup.json', {
      type: 'application/json',
    })

    await createTextSource('导入之后新增的材料', '新')
    expect(await db.sources.count()).toBe(2)

    await importBackup(file)
    expect(await db.sources.count()).toBe(1)
  })
})
