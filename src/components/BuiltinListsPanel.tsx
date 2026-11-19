import { useState } from 'react'
import { sourcesRepo } from '../db/repo'
import { BUILTIN_LISTS, type BuiltinList } from '../services/builtinLists'
import { importWordList, parseWordList } from '../services/wordlist'
import { uid } from '../lib/id'
import { useSettings } from '../store/settings'

interface BuiltinListsPanelProps {
  /** Whether the reverse cards are created as well. */
  bidirectional: boolean
  /** Called after something was imported, so the page can refresh its lists. */
  onImported?: () => void
}

/**
 * The word lists that come with the app.
 *
 * The user decides what happens to them: turn them into flashcards, or just
 * keep the list as material in the library.
 */
export function BuiltinListsPanel({ bidirectional, onImported }: BuiltinListsPanelProps) {
  const settings = useSettings((state) => state.settings)
  const [generateCards, setGenerateCards] = useState(true)
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; words: string[] } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleImport = async (list: BuiltinList) => {
    setBusy(list.key)
    setError(null)
    setStatus(null)
    try {
      const text = await list.load()
      const parsed = parseWordList(text)
      if (parsed.entries.length === 0) {
        throw new Error('这个词表里没有解析出词条')
      }

      // 同一个词表只导入一次，避免卡片库里出现两份一样的材料。
      const existing = (await sourcesRepo.list()).find((source) => source.title === list.title)
      if (existing) {
        setStatus(`「${list.title}」已经导入过了，没有重复导入。`)
        return
      }

      if (!generateCards) {
        // 只要词表，不要卡片：把它作为材料存进卡片库。
        await sourcesRepo.put({
          id: uid('src'),
          kind: 'text',
          title: list.title,
          text: text.trim(),
          createdAt: Date.now(),
          generationStatus: 'done',
        })
        setStatus(`已把「${list.title}」（${parsed.entries.length} 词）存进卡片库，没有生成卡片。`)
        onImported?.()
        return
      }

      const result = await importWordList(parsed.entries, {
        bidirectional,
        settings,
        title: list.title,
        rawText: text,
        // The list's short name is the default category, so importing 四级
        // gives a 「四级」 bucket in the library.
        category: category.trim() || list.shortName,
      })
      const parts = [`已导入「${list.title}」：${result.cards.length} 张卡片`]
      if (result.clozeCount > 0) parts.push(`含 ${result.clozeCount} 张填空题`)
      if (parsed.skipped.length > 0) parts.push(`${parsed.skipped.length} 行无法识别已跳过`)
      setStatus(`${parts.join('，')}。`)
      onImported?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handlePreview = async (list: BuiltinList) => {
    setBusy(list.key)
    setError(null)
    try {
      const text = await list.load()
      const parsed = parseWordList(text)
      setPreview({
        key: list.key,
        words: parsed.entries.slice(0, 12).map((entry) => `${entry.term} - ${entry.definition}`),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel">
      <h2>内置词库</h2>
      <p className="muted small">
        整理好的核心词表，点一下就能用，不用自己去找词表。词表随应用一起下载，装好后离线也能用。
      </p>

      <ul className="builtin-list">
        {BUILTIN_LISTS.map((list) => (
          <li key={list.key} className="builtin-item">
            <div className="builtin-main">
              <div className="builtin-title">
                {list.title}
                <span className="muted small">{list.count} 词</span>
              </div>
              <div className="muted small">{list.description}</div>
            </div>
            <div className="builtin-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void handlePreview(list)}
                disabled={busy !== null}
              >
                预览
              </button>
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => void handleImport(list)}
                disabled={busy !== null}
              >
                {busy === list.key ? '导入中…' : '导入'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={generateCards}
          onChange={(event) => setGenerateCards(event.target.checked)}
          disabled={busy !== null}
        />
        <span>导入后生成卡片</span>
      </label>
      <p className="muted small">
        {generateCards
          ? '导入后会生成可复习的卡片。'
          : '取消勾选就只把词表存进「卡片库」当资料，不会产生任何复习任务。'}
      </p>

      <label className="field">
        <span className="field-label">分类（可选）</span>
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="留空则用词表自己的名字"
          disabled={busy !== null}
        />
        <span className="field-help">
          导入后可以在「卡片库」里按分类筛选。
        </span>
      </label>

      {preview && (
        <div className="builtin-preview">
          <pre className="wordlist-sample">{preview.words.join('\n')}</pre>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => setPreview(null)}
          >
            收起
          </button>
        </div>
      )}

      {status && <div className="alert alert-ok">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </section>
  )
}
