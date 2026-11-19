import { useEffect, useState } from 'react'
import { BlobImage } from '../components/BlobImage'
import { BuiltinListsPanel } from '../components/BuiltinListsPanel'
import { ImageDropzone } from '../components/ImageDropzone'
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
import { importWordList, parseWordList } from '../services/wordlist'
import { useSettings } from '../store/settings'

interface SourceSummary {
  source: Source
  cardCount: number
}

type MaterialMode = 'text' | 'image'

export default function IngestPage() {
  const settings = useSettings((state) => state.settings)

  // ── 批量词表（纯本地解析）──────────────────────────────
  const [wordList, setWordList] = useState('')
  const [wordListTitle, setWordListTitle] = useState('')
  const [wordListCategory, setWordListCategory] = useState('')
  const [bidirectional, setBidirectional] = useState(true)
  const [wordListBusy, setWordListBusy] = useState(false)
  const [wordListNotice, setWordListNotice] = useState<string | null>(null)
  const [wordListError, setWordListError] = useState<string | null>(null)

  // ── AI 材料生成（实验性）───────────────────────────────
  const [mode, setMode] = useState<MaterialMode>('text')
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

  /**
   * The whole point of the local path: paste a word list, get cards.
   * No API key, no network, no model.
   */
  const handleImportWordList = async () => {
    if (!wordList.trim()) {
      setWordListError('请先粘贴词表')
      return
    }

    setWordListBusy(true)
    setWordListError(null)
    setWordListNotice(null)

    try {
      const parsed = parseWordList(wordList)
      if (parsed.entries.length === 0) {
        setWordListError(
          parsed.skipped.length > 0
            ? `没有解析出词条。请每行写成「apple - 苹果」或「apple,苹果」这样的格式。`
            : '没有解析出词条。请每行写成「apple - 苹果」或「apple,苹果」这样的格式。',
        )
        return
      }

      const result = await importWordList(parsed.entries, {
        bidirectional,
        settings,
        title: wordListTitle,
        rawText: wordList,
        category: wordListCategory,
      })

      const parts = [
        `已生成 ${result.cards.length} 张卡片（${result.concepts.length} 个词条）`,
      ]
      if (bidirectional) parts.push('含双向卡片')
      if (result.clozeCount > 0) parts.push(`含 ${result.clozeCount} 张填空题`)
      if (wordListCategory.trim()) parts.push(`分类「${wordListCategory.trim()}」`)
      if (parsed.duplicates > 0) parts.push(`忽略 ${parsed.duplicates} 条重复`)
      if (parsed.skipped.length > 0) parts.push(`${parsed.skipped.length} 行无法识别已跳过`)
      setWordListNotice(`${parts.join('，')}。`)

      setWordList('')
      setWordListTitle('')
      setWordListCategory('')
      await refresh()
    } catch (err) {
      setWordListError(err instanceof Error ? err.message : String(err))
    } finally {
      setWordListBusy(false)
    }
  }

  const handleGenerateText = async () => {
    if (!text.trim()) {
      setError('请先粘贴一段材料')
      return
    }
    if (!settings.apiKey.trim()) {
      setError('请先在「设置 → 高级 / 实验性 AI 设置」里填写 API Key')
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
      setError('请先在「设置 → 高级 / 实验性 AI 设置」里填写 API Key')
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

  const preview = parseWordList(wordList)

  return (
    <div className="page">
      <header className="page-head">
        <h1>导入</h1>
        <p className="muted">
          粘贴词表，直接生成卡片。全部在本地完成，不需要联网，也不需要 API Key。
        </p>
      </header>

      {/* ── 批量词表（默认）────────────────────────────── */}
      <section className="panel">        <h2>批量词表</h2>
        <p className="muted small">
          每行一个词条，用 <code>-</code>、<code>,</code>、<code>，</code> 或 Tab
          分隔英文和中文。例如：
        </p>
        <pre className="wordlist-sample">{`apple - 苹果
banana - 香蕉
orange,橙子
I [go] to school every day. - 我每天去上学。`}</pre>
        <p className="muted small">
          用 <code>[答案]</code> 或 <code>{'{{c1::答案}}'}</code> 包住的内容会自动变成
          <strong>填空题</strong>：学习时先把它遮住，让你把空缺处补回来。
        </p>

        <label className="field">
          <span className="field-label">标题（可选）</span>
          <input
            value={wordListTitle}
            onChange={(event) => setWordListTitle(event.target.value)}
            placeholder="例如：四级核心词汇"
            disabled={wordListBusy}
          />
        </label>

        <label className="field">
          <span className="field-label">分类（可选）</span>
          <input
            value={wordListCategory}
            onChange={(event) => setWordListCategory(event.target.value)}
            placeholder="例如：四级、口语、易错"
            disabled={wordListBusy}
          />
          <span className="field-help">
            导入后可以到「卡片库」里按分类筛选；不填也没关系，随时能改。
          </span>
        </label>

        <label className="field">
          <span className="field-label">词表内容</span>
          <textarea
            value={wordList}
            onChange={(event) => setWordList(event.target.value)}
            placeholder={'apple - 苹果\nbanana - 香蕉\norange,橙子'}
            rows={10}
            disabled={wordListBusy}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={(event) => setBidirectional(event.target.checked)}
            disabled={wordListBusy}
          />
          <span>生成双向卡片（同时生成「英→中」和「中→英」）</span>
        </label>

        {wordList.trim() && (
          <p className="muted small">
            已识别 {preview.entries.length} 条
            {preview.skipped.length > 0 && `，${preview.skipped.length} 行待确认`}
            {preview.duplicates > 0 && `，${preview.duplicates} 条重复`}
          </p>
        )}

        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleImportWordList}
            disabled={wordListBusy}
          >
            {wordListBusy ? '生成中…' : '解析并生成卡片'}
          </button>
          {bidirectional && <span className="muted small">每条词条会生成 2 张卡片</span>}
        </div>

        {wordListError && <div className="alert alert-error">{wordListError}</div>}
        {wordListNotice && <div className="alert alert-ok">{wordListNotice}</div>}
      </section>

      <BuiltinListsPanel bidirectional={bidirectional} onImported={() => void refresh()} />

      {/* ── AI 材料生成（实验性，收起）─────────────────── */}
      <details className="panel experimental">
        <summary>
          <span>高级：AI 材料生成</span>
          <span className="chip chip-experimental">实验性功能，暂不维护</span>
        </summary>

        <p className="muted small">
          让模型从一段材料或一张图片里自动提取概念并出题。需要 API Key，
          且效果依赖模型能力 —— 日常背单词用上面的批量词表就够了。
        </p>

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

        {fallback && (
          <div className="image-preview">
            <BlobImage blob={fallback.blob} alt="原图" />
          </div>
        )}
        {fallback && (
          <label className="field">
            <span className="field-label">手动补录图片文字</span>
            <textarea
              value={fallbackText}
              onChange={(event) => setFallbackText(event.target.value)}
              placeholder="对照图片，把文字抄录或粘贴到这里…"
              rows={8}
              disabled={busy}
            />
          </label>
        )}
        {fallback && (
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
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}
      </details>

      {/* ── 已有材料 ────────────────────────────────────── */}
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

function RecentReviews() {
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof reviewLogsRepo.listRecent>>>([])

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
