import { useEffect, useState } from 'react'
import { ImageDropzone } from '../components/ImageDropzone'
import { BlobImage } from '../components/BlobImage'
import { cardsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import type { Source } from '../db/schema'
import { formatDateTime, formatRelative } from '../lib/date'
import { prepareImage, type PreparedImage } from '../lib/image'
import {
  continueWithManualText,
  createImageSource,
  createTextSource,
  generateForSource,
  ImageReadError,
} from '../services/ingest'
import { useSettings } from '../store/settings'

interface SourceSummary {
  source: Source
  cardCount: number
}

type InputMode = 'text' | 'image'

export default function IngestPage() {
  const settings = useSettings((state) => state.settings)
  const [mode, setMode] = useState<InputMode>('text')

  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<SourceSummary[]>([])

  const [image, setImage] = useState<PreparedImage | null>(null)
  const [imageName, setImageName] = useState('')

  /** Set when an image could not be read and the user must type it instead. */
  const [fallback, setFallback] = useState<{ sourceId: string; blob: Blob } | null>(null)
  const [fallbackText, setFallbackText] = useState('')

  const refresh = async () => {
    const list = await sourcesRepo.list()
    const withCounts = await Promise.all(
      list.map(async (source) => ({
        source,
        cardCount: (await cardsRepo.listBySource(source.id)).length,
      })),
    )
    setSummaries(withCounts)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleGenerateText = async () => {
    if (!text.trim()) {
      setError('请先粘贴一段材料')
      return
    }
    if (!settings.apiKey.trim()) {
      setError('请先在「设置」里填写 API Key')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const source = await createTextSource(text, title)
      const result = await generateForSource(source.id, settings)
      setNotice(
        `已生成 ${result.concepts.length} 个原子概念、${result.cards.length} 张卡片。${
          result.cards.length > 0 ? '现在去「学习」页面开始复习。' : ''
        }`,
      )
      setText('')
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleSelectImage = async (file: File) => {
    setError(null)
    setNotice(null)
    setFallback(null)
    try {
      const prepared = await prepareImage(file)
      setImage(prepared)
      setImageName(file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setImage(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleGenerateImage = async () => {
    if (!image) {
      setError('请先选择一张图片')
      return
    }
    if (!settings.apiKey.trim()) {
      setError('请先在「设置」里填写 API Key')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const source = await createImageSource(image.blob, imageName, image.mimeType)
      const result = await generateForSource(source.id, settings)
      setNotice(
        `已从图片生成 ${result.concepts.length} 个原子概念、${result.cards.length} 张卡片。`,
      )
      setImage(null)
      setImageName('')
    } catch (err) {
      if (err instanceof ImageReadError) {
        // The model could not read the image — show the picture and let the
        // user type the content instead.
        setFallback({ sourceId: err.sourceId, blob: image.blob })
        setError(
          `无法直接读取这张图片：${err.message}。请对照下面的原图，把文字内容输入进来。`,
        )
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleContinueManual = async () => {
    if (!fallback || !fallbackText.trim()) {
      setError('请先输入图片中的文字内容')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const result = await continueWithManualText(fallback.sourceId, fallbackText, settings)
      setNotice(
        `已根据手动输入的文字生成 ${result.concepts.length} 个原子概念、${result.cards.length} 张卡片。`,
      )
      setFallback(null)
      setFallbackText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleRetry = async (sourceId: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await generateForSource(sourceId, settings)
      setNotice(`已重新生成 ${result.cards.length} 张卡片`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleDelete = async (sourceId: string) => {
    await sourcesRepo.remove(sourceId)
    await refresh()
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>输入材料</h1>
        <p className="muted">
          粘贴笔记或上传图片。系统会切分原子概念、生成提取练习题，并交给 FSRS 安排首次复习。
        </p>
      </header>

      <section className="panel">
        <div className="segmented mode-switch">
          <button
            type="button"
            className={mode === 'text' ? 'active' : ''}
            onClick={() => setMode('text')}
          >
            文字
          </button>
          <button
            type="button"
            className={mode === 'image' ? 'active' : ''}
            onClick={() => setMode('image')}
          >
            图片
          </button>
        </div>

        {mode === 'text' ? (
          <>
            <label className="field">
              <span className="field-label">标题（可选）</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：操作系统 · 进程与线程"
                disabled={busy}
              />
            </label>

            <label className="field">
              <span className="field-label">材料内容</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="在这里粘贴要记忆的材料…"
                rows={12}
                disabled={busy}
              />
            </label>

            <div className="row-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerateText}
                disabled={busy}
              >
                {busy ? '生成中…' : '生成概念与卡片'}
              </button>
              <span className="muted small">
                每个概念生成 {settings.questionsPerConcept} 道题，难度按 30% / 50% / 20% 配比
              </span>
            </div>
          </>
        ) : (
          <>
            <ImageDropzone onImage={handleSelectImage} disabled={busy} />

            {image && (
              <div className="image-preview">
                <img src={image.dataUrl} alt="待识别的图片" />
                <div className="image-preview-meta">
                  <div className="image-name">{imageName || '图片'}</div>
                  <div className="muted small">
                    {image.width > 0 ? `${image.width}×${image.height} · ` : ''}
                    {(image.size / 1024).toFixed(0)} KB
                  </div>
                  <label className="field">
                    <span className="field-label">标题（可选）</span>
                    <input
                      value={imageName}
                      onChange={(event) => setImageName(event.target.value)}
                      placeholder="给这张图片起个名字"
                      disabled={busy}
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="row-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerateImage}
                disabled={busy || !image}
              >
                {busy ? '识别中…' : '识别图片并生成卡片'}
              </button>
              <span className="muted small">
                视觉模型：{settings.visionModel.trim() || settings.model || '未配置'}
              </span>
            </div>
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}
      </section>

      {fallback && (
        <section className="panel">
          <h2>手动补录图片文字</h2>
          <p className="muted">
            当前模型无法直接读图，或网络请求失败。请对照下面的原图，把图片里的文字内容输入进来，
            之后会继续走「文字 → 概念 → 卡片」的正常流程。
          </p>
          <div className="image-preview">
            <BlobImage blob={fallback.blob} alt="原图" />
          </div>
          <label className="field">
            <span className="field-label">图片中的文字内容</span>
            <textarea
              value={fallbackText}
              onChange={(event) => setFallbackText(event.target.value)}
              placeholder="对照图片，把文字抄录或粘贴到这里…"
              rows={8}
              disabled={busy}
            />
          </label>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleContinueManual}
              disabled={busy}
            >
              {busy ? '生成中…' : '用这段文字继续生成'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFallback(null)
                setFallbackText('')
              }}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>材料与卡片</h2>
        {summaries.length === 0 ? (
          <p className="muted">还没有任何材料。</p>
        ) : (
          <ul className="source-list">
            {summaries.map(({ source, cardCount }) => (
              <li key={source.id} className="source-item">
                <div className="source-main">
                  <div className="source-title">
                    {source.kind === 'image' && <span className="chip">图片</span>}
                    {source.title}
                  </div>
                  <div className="source-meta">
                    {formatDateTime(source.createdAt)} · {cardCount} 张卡片
                  </div>
                  {source.generationStatus === 'failed' && source.generationError && (
                    <div className="source-error">{source.generationError}</div>
                  )}
                </div>
                <div className="source-actions">
                  <span className={`badge badge-${source.generationStatus}`}>
                    {source.generationStatus === 'done'
                      ? '已生成'
                      : source.generationStatus === 'failed'
                        ? '失败'
                        : '待生成'}
                  </span>
                  {source.generationStatus === 'failed' && (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => handleRetry(source.id)}
                      disabled={busy}
                    >
                      重试
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => handleDelete(source.id)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecentReviews />
    </div>
  )
}

function RecentReviews() {  const [logs, setLogs] = useState<Awaited<ReturnType<typeof reviewLogsRepo.listRecent>>>([])

  useEffect(() => {
    void reviewLogsRepo.listRecent(10).then(setLogs)
  }, [])

  if (logs.length === 0) return null

  return (
    <section className="panel">
      <h2>最近复习</h2>
      <ul className="log-list">
        {logs.map((log) => (
          <li key={log.id} className="log-item">
            <span className={`chip chip-${log.rating}`}>评分 {log.rating}</span>
            {log.mode === 'ai' && <span className="chip">AI 评判</span>}
            <span className="muted small">{formatDateTime(log.reviewedAt)}</span>
            <span className="muted small">下次 {formatRelative(log.dueAt)}后</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
