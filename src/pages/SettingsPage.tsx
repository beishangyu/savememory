import { useEffect, useRef, useState } from 'react'
import type { ProviderKind, Settings } from '../db/schema'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_VISION_MODEL,
  providerFromSettings,
} from '../llm'
import { downloadBackup, importBackup } from '../services/backup'
import { useSettings } from '../store/settings'

type Draft = Omit<Settings, 'id'>

export default function SettingsPage() {
  const settings = useSettings((state) => state.settings)
  const save = useSettings((state) => state.save)
  const load = useSettings((state) => state.load)

  const [draft, setDraft] = useState<Draft>(() => ({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    visionModel: settings.visionModel,
    apiKey: settings.apiKey,
    desiredRetention: settings.desiredRetention,
    maximumInterval: settings.maximumInterval,
    questionsPerConcept: settings.questionsPerConcept,
    gradingMode: settings.gradingMode,
    ocrEndpoint: settings.ocrEndpoint,
  }))
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      visionModel: settings.visionModel,
      apiKey: settings.apiKey,
      desiredRetention: settings.desiredRetention,
      maximumInterval: settings.maximumInterval,
      questionsPerConcept: settings.questionsPerConcept,
      gradingMode: settings.gradingMode,
      ocrEndpoint: settings.ocrEndpoint,
    })
  }, [settings])

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const switchProvider = (provider: ProviderKind) => {
    setDraft((current) => ({
      ...current,
      provider,
      baseUrl: DEFAULT_BASE_URL[provider],
      model: DEFAULT_MODEL[provider],
      visionModel: current.visionModel,
    }))
  }

  const handleSave = async () => {
    await save(draft)
    setStatus('设置已保存（保存在本地）')
  }

  const handleTest = async () => {
    setTesting(true)
    setStatus(null)
    try {
      const provider = providerFromSettings({ ...draft, id: 'settings' })
      const reply = await provider.generate(
        [
          { role: 'system', text: '只回复一个 JSON 对象。' },
          { role: 'user', text: '回复 {"ok":true} 这个 JSON 对象即可。' },
        ],
        { json: true, temperature: 0, maxTokens: 64 },
      )
      setStatus(`连接成功。模型回复：${reply.slice(0, 120)}`)
    } catch (err) {
      setStatus(`连接失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTesting(false)
    }
  }

  const handleExport = async () => {
    setBackupBusy(true)
    setBackupStatus(null)
    try {
      const counts = await downloadBackup()
      setBackupStatus(
        `已导出 ${counts.sources} 份材料、${counts.concepts} 个概念、${counts.cards} 张卡片、${counts.reviewLogs} 条复习记录。`,
      )
    } catch (err) {
      setBackupStatus(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  const handleImport = async (file: File) => {
    setBackupBusy(true)
    setBackupStatus(null)
    try {
      const counts = await importBackup(file)
      // Pull the restored settings into the store so the UI reflects them.
      await load()
      setBackupStatus(
        `已恢复 ${counts.sources} 份材料、${counts.concepts} 个概念、${counts.cards} 张卡片、${counts.reviewLogs} 条复习记录。`,
      )
    } catch (err) {
      setBackupStatus(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>设置</h1>
        <p className="muted">
          所有配置与数据都保存在本机浏览器中，不需要登录。API Key 仅用于向模型发起请求。
        </p>
      </header>

      <section className="panel">
        <h2>模型接口</h2>

        <div className="field">
          <span className="field-label">接口类型</span>
          <div className="segmented">
            <button
              type="button"
              className={draft.provider === 'openai' ? 'active' : ''}
              onClick={() => switchProvider('openai')}
            >
              OpenAI 兼容
            </button>
            <button
              type="button"
              className={draft.provider === 'gemini' ? 'active' : ''}
              onClick={() => switchProvider('gemini')}
            >
              Gemini
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            value={draft.baseUrl}
            onChange={(event) => update('baseUrl', event.target.value)}
            placeholder={DEFAULT_BASE_URL[draft.provider]}
          />
        </label>

        <label className="field">
          <span className="field-label">主模型（出题、评判）</span>
          <input
            value={draft.model}
            onChange={(event) => update('model', event.target.value)}
            placeholder={DEFAULT_MODEL[draft.provider]}
          />
        </label>

        <label className="field">
          <span className="field-label">视觉模型（读取图片，可留空）</span>
          <input
            value={draft.visionModel}
            onChange={(event) => update('visionModel', event.target.value)}
            placeholder={`留空则使用主模型（建议：${DEFAULT_VISION_MODEL[draft.provider]}）`}
          />
          <span className="field-help">
            留空表示复用主模型。填一个不支持读图的模型时，上传图片会提示改用手动补录文字。
          </span>
        </label>

        <label className="field">
          <span className="field-label">API Key</span>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder="sk-…"
            autoComplete="off"
          />
        </label>

        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存设置
          </button>
          <button type="button" className="btn" onClick={handleTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>

        {status && <div className="alert alert-ok">{status}</div>}
      </section>

      <section className="panel">
        <h2>学习评判方式</h2>

        <div className="field">
          <span className="field-label">作答后如何打分</span>
          <div className="segmented">
            <button
              type="button"
              className={draft.gradingMode === 'self' ? 'active' : ''}
              onClick={() => update('gradingMode', 'self')}
            >
              手动自评
            </button>
            <button
              type="button"
              className={draft.gradingMode === 'ai' ? 'active' : ''}
              onClick={() => update('gradingMode', 'ai')}
            >
              AI 评判
            </button>
          </div>
          <span className="field-help">
            AI 评判模式下，你会先写下答案，AI 给出「正确 / 部分正确 / 错误」和对应档位建议，
            你可以随时改选其他档位。评判失败会自动退回手动评分，不会替你打分。
          </span>
        </div>

        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>图片处理</h2>

        <label className="field">
          <span className="field-label">自定义 OCR 接口（可选，留空即禁用）</span>
          <input
            value={draft.ocrEndpoint}
            onChange={(event) => update('ocrEndpoint', event.target.value)}
            placeholder="https://example.com/ocr"
          />
          <span className="field-help">
            当视觉模型不可用时会调用它。约定：POST JSON{' '}
            <code>{'{"image":"data:image/png;base64,…"}'}</code>，期望返回{' '}
            <code>{'{"text":"识别出的文字"}'}</code> 或纯文本。未配置时改为展示原图，由你手动补录文字。
          </span>
        </label>

        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>调度与出题</h2>

        <label className="field">
          <span className="field-label">
            目标记忆保持率（{draft.desiredRetention.toFixed(2)}）越高，复习越频繁
          </span>
          <input
            type="range"
            min={0.7}
            max={0.97}
            step={0.01}
            value={draft.desiredRetention}
            onChange={(event) => update('desiredRetention', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span className="field-label">最大复习间隔（天）</span>
          <input
            type="number"
            min={1}
            max={36500}
            value={draft.maximumInterval}
            onChange={(event) => update('maximumInterval', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span className="field-label">每个概念生成几道题</span>
          <input
            type="number"
            min={1}
            max={5}
            value={draft.questionsPerConcept}
            onChange={(event) => update('questionsPerConcept', Number(event.target.value))}
          />
        </label>

        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>数据备份与恢复</h2>
        <p className="muted">
          所有数据都存在这台设备的浏览器里。换手机、清理浏览器数据前，请先导出备份。
        </p>

        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={backupBusy}
          >
            {backupBusy ? '处理中…' : '导出数据'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => importRef.current?.click()}
            disabled={backupBusy}
          >
            导入数据
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleImport(file)
            }}
          />
        </div>

        <div className="alert alert-warn">
          <strong>导入会覆盖当前的全部本地数据</strong>（材料、概念、卡片、复习记录）。
          导入前请先导出一份当前数据以防万一。
        </div>

        <p className="muted small">
          导出文件不包含 API Key —— 密钥不会离开你的设备，恢复后请在「模型接口」里重新填写。
          其它所有内容（含图片）都会完整保存。
        </p>

        {backupStatus && <div className="alert alert-ok">{backupStatus}</div>}
      </section>

      <section className="panel">
        <h2>关于</h2>
        <ul className="about-list">
          <li>
            <strong>调度</strong>：使用 ts-fsrs（FSRS-7）算法，AI 不参与排期。
          </li>
          <li>
            <strong>学习动作</strong>：默认只显示题干，必须先尝试回忆再看答案。
          </li>
          <li>
            <strong>存储</strong>：IndexedDB（通过 Dexie），数据与图片都留在本机。
          </li>
        </ul>
      </section>
    </div>
  )
}
