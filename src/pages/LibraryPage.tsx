import { useEffect, useMemo, useState } from 'react'
import { CategoryEditor } from '../components/CategoryEditor'
import { cardsRepo, conceptsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import type { Card, Concept, ErrorCause, ReviewLog, Source } from '../db/schema'
import { formatDate, formatRelative } from '../lib/date'
import { QUESTION_TYPE_LABEL } from '../llm/prompts'
import {
  conceptCategories,
  editCategoriesOfConcepts,
  setConceptCategories,
  tallyCategories,
  type CategoryTally,
} from '../services/categories'
import { useNav } from '../store/nav'
import { useScope } from '../store/scope'

interface Bundle {
  source: Source
  concepts: Concept[]
  cards: Card[]
}

interface Stats {
  totalCards: number
  dueCards: number
  reviews: number
  reviewsToday: number
}

/** Per-concept error-cause tallies, used to flag concepts that need re-teaching. */
interface CauseTally {
  forgotten: number
  confused: number
  not_understood: number
}

const CAUSE_LABEL: Record<ErrorCause, string> = {
  forgotten: '遗忘',
  confused: '混淆',
  not_understood: '没理解',
}

function tallyCauses(logs: ReviewLog[]): Map<string, CauseTally> {
  const map = new Map<string, CauseTally>()
  for (const log of logs) {
    if (!log.errorCause) continue
    const tally = map.get(log.conceptId) ?? { forgotten: 0, confused: 0, not_understood: 0 }
    tally[log.errorCause] += 1
    map.set(log.conceptId, tally)
  }
  return map
}

/** Whether a piece of text contains the search term. */
function matches(text: string, term: string): boolean {
  return text.toLowerCase().includes(term)
}

/**
 * The bulk category control for a whole material.
 *
 * It shows the categories the material already carries and applies the
 * difference — so adding a name puts it on every word, and removing one
 * takes it off every word.
 */
function BulkCategoryEditor({
  concepts,
  suggestions,
  onApply,
}: {
  concepts: Concept[]
  suggestions: string[]
  onApply: (concepts: Concept[], before: string[], after: string[]) => Promise<void>
}) {
  const before = useMemo(
    () => [...new Set(concepts.flatMap((concept) => conceptCategories(concept)))],
    [concepts],
  )
  const [after, setAfter] = useState<string[] | null>(null)
  const shown = after ?? before

  return (
    <CategoryEditor
      categories={shown}
      suggestions={suggestions}
      label="加到这份材料"
      onChange={(next) => {
        setAfter(next)
        void onApply(concepts, before, next)
      }}
    />
  )
}

export default function LibraryPage() {
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [stats, setStats] = useState<Stats>({
    totalCards: 0,
    dueCards: 0,
    reviews: 0,
    reviewsToday: 0,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [logs, setLogs] = useState<ReviewLog[]>([])
  const [causes, setCauses] = useState<Map<string, CauseTally>>(new Map())

  /** The category the library is filtered by; `null` means everything. */
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  /** The search term. */
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = async () => {
      const sources = await sourcesRepo.list()
      const next: Bundle[] = []
      for (const source of sources) {
        next.push({
          source,
          concepts: await conceptsRepo.listBySource(source.id),
          cards: await cardsRepo.listBySource(source.id),
        })
      }
      setBundles(next)

      const allLogs = await reviewLogsRepo.listRecent(200)
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      setLogs(allLogs)
      setCauses(tallyCauses(allLogs))
      setStats({
        totalCards: await cardsRepo.count(),
        dueCards: await cardsRepo.countDue(Date.now()),
        reviews: await reviewLogsRepo.count(),
        reviewsToday: allLogs.filter((log) => log.reviewedAt >= startOfToday).length,
      })
    }
    void load()
  }, [])

  /** How many cards each concept owns. */
  const cardCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const bundle of bundles) {
      for (const card of bundle.cards) {
        map.set(card.conceptId, (map.get(card.conceptId) ?? 0) + 1)
      }
    }
    return map
  }, [bundles])

  const allConcepts = useMemo(
    () => bundles.flatMap((bundle) => bundle.concepts),
    [bundles],
  )

  const categories = useMemo<CategoryTally[]>(
    () => tallyCategories(allConcepts, cardCounts),
    [allConcepts, cardCounts],
  )

  const categoryNames = useMemo(
    () => categories.map((category) => category.name),
    [categories],
  )

  const term = query.trim().toLowerCase()

  /** The concepts and cards that survive the current filter. */
  const filtered = useMemo(() => {
    return bundles.map((bundle) => {
      const concepts = bundle.concepts
        .map((concept) => {
          const cards = bundle.cards.filter((card) => card.conceptId === concept.id)
          if (activeCategory && !conceptCategories(concept).includes(activeCategory)) {
            return null
          }
          if (!term) return { concept, cards }
          const conceptHit =
            matches(concept.title, term) || matches(concept.statement, term)
          const hitCards = cards.filter(
            (card) => matches(card.prompt, term) || matches(card.answer, term),
          )
          if (!conceptHit && hitCards.length === 0) return null
          return { concept, cards: conceptHit ? cards : hitCards }
        })
        .filter((entry): entry is { concept: Concept; cards: Card[] } => entry !== null)
      return {
        source: bundle.source,
        concepts,
        cardCount: concepts.reduce((sum, entry) => sum + entry.cards.length, 0),
      }
    })
  }, [bundles, activeCategory, term])

  const visibleBundles = filtered.filter((bundle) => bundle.concepts.length > 0)

  /** Applies new categories to a set of concepts and keeps the UI in sync. */
  const applyCategories = async (concepts: Concept[], categories: string[]) => {
    if (concepts.length === 0) return
    const ids = new Set(concepts.map((concept) => concept.id))
    await setConceptCategories(concepts, categories)
    setBundles((current) =>
      current.map((bundle) => ({
        ...bundle,
        concepts: bundle.concepts.map((concept) =>
          ids.has(concept.id) ? { ...concept, categories } : concept,
        ),
      })),
    )
  }

  /**
   * A bulk edit on a whole material: the categories it already carries are
   * added to every word, the removed ones are taken off every word.
   */
  const applyBulkCategories = async (
    concepts: Concept[],
    before: string[],
    after: string[],
  ) => {
    if (concepts.length === 0) return
    const added = after.filter((name) => !before.includes(name))
    const removed = before.filter((name) => !after.includes(name))
    const ids = new Set(concepts.map((concept) => concept.id))
    await editCategoriesOfConcepts(concepts, added, removed)
    setBundles((current) =>
      current.map((bundle) => ({
        ...bundle,
        concepts: bundle.concepts.map((concept) => {
          if (!ids.has(concept.id)) return concept
          const kept = conceptCategories(concept).filter((name) => !removed.includes(name))
          for (const name of added) {
            if (!kept.includes(name)) kept.push(name)
          }
          return { ...concept, categories: kept }
        }),
      })),
    )
  }

  const totalVisible = visibleBundles.reduce(
    (sum, bundle) => sum + bundle.concepts.length,
    0,
  )

  return (
    <div className="page">
      <header className="page-head">
        <h1>卡片库</h1>
        <p className="muted">所有材料、原子概念与卡片都保存在本地浏览器数据库中。</p>
      </header>

      <section className="panel">
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-value">{stats.totalCards}</div>
            <div className="muted small">卡片总数</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.dueCards}</div>
            <div className="muted small">已到期</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.reviews}</div>
            <div className="muted small">复习总次数</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{stats.reviewsToday}</div>
            <div className="muted small">今日复习</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>分类</h2>
        <p className="muted small">
          给词条打上分类，就能按分类浏览。分类可以自己起名字，比如「四级」「口语」「易错」。
        </p>

        <div className="category-bar">
          <button
            type="button"
            className={`chip chip-filter${activeCategory === null ? ' active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            全部
          </button>
          {categories.map((category) => (
            <button
              key={category.name}
              type="button"
              className={`chip chip-filter${
                activeCategory === category.name ? ' active' : ''
              }`}
              onClick={() =>
                setActiveCategory(
                  activeCategory === category.name ? null : category.name,
                )
              }
            >
              {category.name}
              <span className="chip-count">{category.cards}</span>
            </button>
          ))}
          {categories.length === 0 && (
            <span className="muted small">还没有分类，展开一份材料给词条加上吧。</span>
          )}
        </div>

        <div className="row-actions">
          <input
            className="library-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索单词或释义…"
            aria-label="搜索"
          />
          {activeCategory && (
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => {
                // Hand the category over to the study page and go there.
                useScope.getState().setCategory(activeCategory)
                useNav.getState().setRoute('study')
              }}
            >
              按「{activeCategory}」分类学习
            </button>
          )}
          {(activeCategory || term) && (
            <span className="muted small">
              命中 {totalVisible} 个词条
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  setActiveCategory(null)
                  setQuery('')
                }}
              >
                清除筛选
              </button>
            </span>
          )}
        </div>
      </section>

      {visibleBundles.length === 0 && (
        <section className="panel">
          <p className="muted">
            {bundles.length === 0
              ? '还没有任何材料。去「导入」页添加词表，或直接用内置词库。'
              : '没有符合条件的词条，换个分类或搜索词试试。'}
          </p>
        </section>
      )}

      {visibleBundles.map((bundle) => (
        <section className="panel" key={bundle.source.id}>
          <div
            className="source-item source-head"
            onClick={() =>
              setExpanded((current) =>
                current === bundle.source.id ? null : bundle.source.id,
              )
            }
          >
            <div className="source-main">
              <div className="source-title">{bundle.source.title}</div>
              <div className="source-meta">
                {bundle.concepts.length} 个概念 · {bundle.cardCount} 张卡片 ·{' '}
                {formatDate(bundle.source.createdAt)}
              </div>
            </div>
            <span className="muted small">{expanded === bundle.source.id ? '收起' : '展开'}</span>
          </div>

          {expanded === bundle.source.id && (
            <div className="expand-body">
              <div className="source-bulk" onClick={(event) => event.stopPropagation()}>
                <span className="muted small">给这份材料的全部词条加分类：</span>
                <BulkCategoryEditor
                  concepts={bundle.concepts.map((entry) => entry.concept)}
                  suggestions={categoryNames}
                  onApply={applyBulkCategories}
                />
              </div>

              {bundle.concepts.map(({ concept, cards }) => {
                const tally = causes.get(concept.id)
                return (
                  <div className="concept-block" key={concept.id}>
                    <div className="concept-title">
                      {concept.title}
                      {concept.tags.map((tag) => (
                        <span className="chip chip-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                      {tally && tally.not_understood > 0 && (
                        <span className="chip chip-flag chip-flag-danger">需要重学</span>
                      )}
                      {tally && tally.confused > 0 && (
                        <span className="chip chip-flag chip-flag-warn">易混淆</span>
                      )}
                      {tally && tally.forgotten > 0 && (
                        <span className="chip chip-flag">易遗忘</span>
                      )}
                    </div>
                    <div className="concept-statement">{concept.statement}</div>
                    <div className="concept-categories">
                      <CategoryEditor
                        categories={conceptCategories(concept)}
                        suggestions={categoryNames}
                        compact
                        onChange={(next) => void applyCategories([concept], next)}
                      />
                    </div>
                    <ul className="card-list">
                      {cards.map((card) => (
                        <li key={card.id} className="card-row">
                          <div className="card-row-main">
                            <div className="card-row-prompt">{card.prompt}</div>
                            <div className="card-row-answer">{card.answer}</div>
                          </div>
                          <div className="card-row-meta">
                            <span className="chip">{QUESTION_TYPE_LABEL[card.type]}</span>
                            <span className="chip chip-difficulty">
                              {
                                card.questionDifficulty === 'easy'
                                  ? '简单'
                                  : card.questionDifficulty === 'medium'
                                    ? '中等'
                                    : '困难'
                              }
                            </span>
                            <span className="muted small">
                              {card.reps === 0
                                ? '未复习'
                                : `复习 ${card.reps} 次 · ${formatRelative(card.dueAt)}后到期`}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ))}

      {logs.length > 0 && (
        <section className="panel">
          <h2>复习历史</h2>
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>评分</th>
                <th>错因</th>
                <th>用时</th>
                <th>下次到期</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.reviewedAt)}</td>
                  <td>
                    <span className={`chip chip-${log.rating}`}>{log.rating}</span>
                  </td>
                  <td className="muted">
                    {log.errorCause ? CAUSE_LABEL[log.errorCause] : '—'}
                  </td>
                  <td className="muted">{Math.round(log.durationMs / 1000)} 秒</td>
                  <td className="muted">{formatRelative(log.dueAt)}后</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
