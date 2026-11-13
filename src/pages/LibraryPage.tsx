import { useEffect, useState } from 'react'
import { cardsRepo, conceptsRepo, reviewLogsRepo, sourcesRepo } from '../db/repo'
import type { Card, Concept, ReviewLog, Source } from '../db/schema'
import { formatDate, formatRelative } from '../lib/date'
import { QUESTION_TYPE_LABEL } from '../llm/prompts'

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

      const allLogs = await reviewLogsRepo.listRecent(30)
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      setLogs(allLogs)
      setStats({
        totalCards: await cardsRepo.count(),
        dueCards: await cardsRepo.countDue(Date.now()),
        reviews: await reviewLogsRepo.count(),
        reviewsToday: allLogs.filter((log) => log.reviewedAt >= startOfToday).length,
      })
    }
    void load()
  }, [])

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

      {bundles.map((bundle) => (
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
                {bundle.concepts.length} 个概念 · {bundle.cards.length} 张卡片 ·{' '}
                {formatDate(bundle.source.createdAt)}
              </div>
            </div>
            <span className="muted small">{expanded === bundle.source.id ? '收起' : '展开'}</span>
          </div>

          {expanded === bundle.source.id && (
            <div className="expand-body">
              {bundle.concepts.map((concept) => (
                <div className="concept-block" key={concept.id}>
                  <div className="concept-title">
                    {concept.title}
                    {concept.tags.map((tag) => (
                      <span className="chip chip-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="concept-statement">{concept.statement}</div>
                  <ul className="card-list">
                    {bundle.cards
                      .filter((card) => card.conceptId === concept.id)
                      .map((card) => (
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
              ))}
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
