import { useEffect, useMemo, useState } from 'react'
import { BlobImage } from '../components/BlobImage'
import { HandwritingCanvas } from '../components/HandwritingCanvas'
import { memosRepo } from '../db/repo'
import type { Memo } from '../db/schema'
import { formatRelative } from '../lib/date'
import { createImageSource, createTextSource, generateForSource } from '../services/ingest'
import { useSettings } from '../store/settings'

interface Composer {
  /** null while creating a new memo, otherwise the memo being edited. */
  id: string | null
  title: string
  content: string
}

export default function MemoPage() {
  const settings = useSettings((state) => state.settings)

  const [memos, setMemos] = useState<Memo[]>([])
  const [composer, setComposer] = useState<Composer | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Keyboard or stylus input for the memo body. */
  const [inputMode, setInputMode] = useState<'keyboard' | 'ink'>('keyboard')
  /** The hand-written memo as a PNG blob. */
  const [inkBlob, setInkBlob] = useState<Blob | null>(null)

  const refresh = async () => {
    setMemos(await memosRepo.list())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return memos
    return memos.filter(
      (memo) =>
        memo.title.toLowerCase().includes(needle) || memo.content.toLowerCase().includes(needle),
    )
  }, [memos, query])

  const handleSave = async () => {
    if (!composer) return
    const content = composer.content.trim()
    const title = composer.title.trim()
    if (!content && !title && !inkBlob) {
      setError('写点内容再保存吧')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const now = Date.now()
      if (composer.id) {
        const existing = await memosRepo.get(composer.id)
        if (existing) {
          await memosRepo.put({
            ...existing,
            title,
            content,
            handwriting: inkBlob ?? existing.handwriting,
            updatedAt: now,
          })
        }
      } else {
        await memosRepo.put({
          id: `memo_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          title,
          content,
          handwriting: inkBlob ?? undefined,
          createdAt: now,
          updatedAt: now,
          pinned: false,
        })
      }
      setComposer(null)
      setInkBlob(null)
      setInputMode('keyboard')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    await memosRepo.remove(id)
    if (composer?.id === id) setComposer(null)
    await refresh()
  }

  const handleTogglePin = async (memo: Memo) => {
    await memosRepo.put({ ...memo, pinned: !memo.pinned, updatedAt: Date.now() })
    await refresh()
  }

  /** Turn a memo into study material through the normal pipeline. */
  const handleConvert = async (memo: Memo) => {
    if (!memo.content.trim() && !memo.handwriting) {
      setError('这条备忘录没有内容，无法生成卡片')
      return
    }
    if (!settings.apiKey.trim()) {
      setError('请先在「设置」里填写 API Key')
      return
    }

    setBusy(true)
    setError(null)
    setStatus(null)

    try {
      // A hand-written memo goes through the vision pipeline, exactly like a
      // photo: the model reads the ink and turns it into material.
      const source = memo.handwriting
        ? await createImageSource(memo.handwriting, memo.title || '手写备忘', 'image/png')
        : await createTextSource(memo.content, memo.title || '备忘录')

      const result = await generateForSource(source.id, settings)
      await memosRepo.put({
        ...memo,
        sourceId: source.id,
        cardCount: result.cards.length,
        updatedAt: Date.now(),
      })
      setStatus(
        `已生成 ${result.concepts.length} 个原子概念、${result.cards.length} 张卡片，去「学习」页面开始复习。`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>备忘录</h1>
        <p className="muted">
          随手记下想法和要点。合适的那条可以一键变成学习材料，走「概念 → 卡片 → FSRS」的完整流程。
        </p>
      </header>

      <section className="panel">
        {composer === null ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => {
            setComposer({ id: null, title: '', content: '' })
            setError(null)
          }}>
            ＋ 写一条
          </button>
        ) : (
          <>
            <label className="field">
              <span className="field-label">标题（可选）</span>
              <input
                value={composer.title}
                onChange={(event) =>
                  setComposer({ ...composer, title: event.target.value })
                }
                placeholder="一句话概括这条备忘"
                disabled={busy}
                autoFocus
              />
            </label>
            <div className="field">
              <span className="field-label">输入方式</span>
              <div className="segmented">
                <button
                  type="button"
                  className={inputMode === 'keyboard' ? 'active' : ''}
                  onClick={() => setInputMode('keyboard')}
                >
                  键盘
                </button>
                <button
                  type="button"
                  className={inputMode === 'ink' ? 'active' : ''}
                  onClick={() => setInputMode('ink')}
                >
                  手写笔
                </button>
              </div>
            </div>

            {inputMode === 'ink' ? (
              <HandwritingCanvas
                onChange={setInkBlob}
                disabled={busy}
                height={260}
                placeholder="用 Apple Pencil 写下这条备忘…"
              />
            ) : (
              <label className="field">
                <span className="field-label">内容</span>
                <textarea
                  value={composer.content}
                  onChange={(event) =>
                    setComposer({ ...composer, content: event.target.value })
                  }
                  placeholder="想到什么就写什么…"
                  rows={8}
                  disabled={busy}
                />
              </label>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={busy}
              >
                {composer.id ? '保存修改' : '保存'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setComposer(null)}
                disabled={busy}
              >
                取消
              </button>
            </div>
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {status && <div className="alert alert-ok">{status}</div>}
      </section>

      {memos.length > 0 && (
        <section className="panel">
          <div className="field">
            <span className="field-label">搜索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按标题或内容过滤…"
            />
          </div>

          {visible.length === 0 ? (
            <p className="muted">没有匹配的备忘。</p>
          ) : (
            <ul className="memo-list">
              {visible.map((memo) => (
                <li key={memo.id} className={`memo ${memo.pinned ? 'memo-pinned' : ''}`}>
                  <div className="memo-head">
                    <div className="memo-title">
                      {memo.pinned && <span className="memo-pin" title="已置顶">📌</span>}
                      {memo.title || '（无标题）'}
                    </div>
                    <div className="muted small">{formatRelative(memo.updatedAt)}前更新</div>
                  </div>
                  {memo.content && <div className="memo-content">{memo.content}</div>}
                  {memo.handwriting && (
                    <div className="memo-ink">
                      <BlobImage blob={memo.handwriting} alt="手写内容" />
                    </div>
                  )}
                  {memo.sourceId && (
                    <div className="muted small">
                      已生成 {memo.cardCount ?? 0} 张卡片
                    </div>
                  )}
                  <div className="memo-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        setComposer({
                          id: memo.id,
                          title: memo.title,
                          content: memo.content,
                        })
                      }
                      disabled={busy}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => void handleConvert(memo)}
                      disabled={busy || (!memo.content.trim() && !memo.handwriting)}
                    >
                      转为学习材料
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => void handleTogglePin(memo)}
                      disabled={busy}
                    >
                      {memo.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => void handleDelete(memo.id)}
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
      )}
    </div>
  )
}
