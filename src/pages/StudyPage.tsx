import { useEffect, useMemo, useState } from 'react'
import { GradeButtons } from '../components/GradeButtons'
import { cardsRepo, conceptsRepo } from '../db/repo'
import type { Concept, ReviewGrade } from '../db/schema'
import { previewGrades } from '../fsrs/scheduler'
import { formatRelative } from '../lib/date'
import { QUESTION_TYPE_LABEL } from '../llm/prompts'
import { useDueCount } from '../hooks/useDueCount'
import { useSettings } from '../store/settings'
import { selectCurrentCard, selectSessionFinished, useStudy } from '../store/study'

const VERDICT_LABEL = {
  correct: '正确',
  partial: '部分正确',
  incorrect: '错误',
} as const

export default function StudyPage() {
  const settings = useSettings((state) => state.settings)
  const dueCount = useDueCount(10_000)
  const aiMode = settings.gradingMode === 'ai'

  const queue = useStudy((state) => state.queue)
  const index = useStudy((state) => state.index)
  const revealed = useStudy((state) => state.revealed)
  const userAnswer = useStudy((state) => state.userAnswer)
  const busy = useStudy((state) => state.busy)
  const error = useStudy((state) => state.error)
  const results = useStudy((state) => state.results)
  const judging = useStudy((state) => state.judging)
  const judgement = useStudy((state) => state.judgement)
  const suggestedGrade = useStudy((state) => state.suggestedGrade)
  const judgeError = useStudy((state) => state.judgeError)
  const start = useStudy((state) => state.start)
  const setUserAnswer = useStudy((state) => state.setUserAnswer)
  const reveal = useStudy((state) => state.reveal)
  const judge = useStudy((state) => state.judge)
  const submit = useStudy((state) => state.submit)
  const reset = useStudy((state) => state.reset)

  const card = useStudy(selectCurrentCard)
  const finished = useStudy(selectSessionFinished)
  const started = queue.length > 0

  const [concept, setConcept] = useState<Concept | null>(null)
  const [preview, setPreview] = useState<Record<ReviewGrade, number> | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!card) {
      setConcept(null)
      return
    }
    let cancelled = false
    void conceptsRepo.get(card.conceptId).then((found) => {
      if (!cancelled) setConcept(found ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [card])

  // Only compute the schedule preview once the answer has been revealed.
  useEffect(() => {
    if (!revealed || !card) {
      setPreview(null)
      return
    }
    let cancelled = false
    void previewGrades(
      { desiredRetention: settings.desiredRetention, maximumInterval: settings.maximumInterval },
      card,
    ).then((result) => {
      if (!cancelled) setPreview(result)
    })
    return () => {
      cancelled = true
    }
  }, [revealed, card, settings.desiredRetention, settings.maximumInterval])

  const handleStart = async () => {
    setStarting(true)
    try {
      const due = await cardsRepo.listDue(Date.now())
      start(due)
    } finally {
      setStarting(false)
    }
  }

  const stats = useMemo(() => {
    const counts = { again: 0, hard: 0, good: 0, easy: 0 }
    for (const result of results) counts[result.grade] += 1
    return counts
  }, [results])

  if (!started) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>学习</h1>
          <p className="muted">
            学习时只显示题干。先回忆、再看答案，最后自评。复习间隔由 FSRS 决定，AI 不参与排期。
          </p>
        </header>

        <section className="panel panel-center">
          <div className="due-big">{dueCount}</div>
          <p className="muted">张卡片已到期</p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleStart}
            disabled={starting || dueCount === 0}
          >
            {starting ? '加载中…' : dueCount === 0 ? '暂无到期卡片' : '开始学习'}
          </button>
          {dueCount === 0 && (
            <p className="muted small">先去「输入」页面添加材料，或等待下次到期时间。</p>
          )}
          {aiMode && (
            <p className="muted small">当前为 AI 评判模式：写下答案后由 AI 给出档位建议。</p>
          )}
        </section>
      </div>
    )
  }

  if (finished) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>本次会话完成</h1>
        </header>
        <section className="panel panel-center">
          <p>
            共复习 <strong>{results.length}</strong> 张卡片。
          </p>
          <div className="stat-row">
            <span className="chip chip-1">重来 {stats.again}</span>
            <span className="chip chip-2">困难 {stats.hard}</span>
            <span className="chip chip-3">良好 {stats.good}</span>
            <span className="chip chip-4">简单 {stats.easy}</span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={() => void handleStart()}>
              继续学习到期卡片
            </button>
            <button type="button" className="btn" onClick={reset}>
              返回
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (!card) return null

  return (
    <div className="page">
      <div className="study-bar">
        <span className="muted small">
          进度 {Math.min(index + 1, queue.length)} / {queue.length}
        </span>
        <div className="progress">
          <div
            className="progress-fill"
            style={{ width: `${Math.round((index / queue.length) * 100)}%` }}
          />
        </div>
        <button type="button" className="btn btn-small btn-ghost" onClick={reset}>
          结束会话
        </button>
      </div>

      <section className="panel card-panel">
        <div className="card-meta">
          <span className="chip">{QUESTION_TYPE_LABEL[card.type]}</span>
          <span className="chip chip-difficulty">
            难度：
            {card.questionDifficulty === 'easy'
              ? '简单'
              : card.questionDifficulty === 'medium'
                ? '中等'
                : '困难'}
          </span>
          {concept && concept.title && <span className="chip">{concept.title}</span>}
          {aiMode && <span className="chip chip-ai">AI 评判</span>}
        </div>

        <h2 className="prompt">{card.prompt}</h2>

        {!revealed ? (
          <>
            <label className="field">
              <span className="field-label">
                {aiMode ? '你的答案' : '你的回忆（可选，可以口述后在脑中作答）'}
              </span>
              <textarea
                value={userAnswer}
                onChange={(event) => setUserAnswer(event.target.value)}
                placeholder={
                  aiMode
                    ? '写下你记得的答案，AI 会对照参考答案给出评级…'
                    : '先试着回忆，写下你想到的答案…'
                }
                rows={4}
                disabled={judging}
              />
            </label>

            {aiMode ? (
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => void judge()}
                  disabled={judging}
                >
                  {judging ? 'AI 评判中…' : '提交答案'}
                </button>
                <button type="button" className="btn" onClick={reveal} disabled={judging}>
                  跳过，直接看答案
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" onClick={reveal}>
                我已回忆，显示答案
              </button>
            )}
          </>
        ) : (
          <>
            {userAnswer.trim() && (
              <div className="user-answer">
                <span className="field-label">你的答案</span>
                <p>{userAnswer}</p>
              </div>
            )}

            {judgement && (
              <div className="judge-box">
                <div className="judge-head">
                  <span className={`judge-verdict judge-${judgement.verdict}`}>
                    AI 判定：{VERDICT_LABEL[judgement.verdict]}
                  </span>
                  <span className="muted small">建议评分 {judgement.suggestedRating}/4</span>
                </div>
                <p className="judge-feedback">{judgement.feedback}</p>
              </div>
            )}

            {judgeError && <div className="alert alert-error">{judgeError}</div>}

            <div className="answer-box">
              <span className="field-label">参考答案</span>
              <p className="answer-text">{card.answer}</p>
              {concept?.statement && (
                <p className="answer-context">所属概念：{concept.statement}</p>
              )}
            </div>

            <p className="muted small">
              {suggestedGrade
                ? 'AI 给出了档位建议，你可以直接采用，也可以改选其他档位。'
                : '回想得怎么样？选择对应档位，FSRS 会据此安排下次复习。'}
            </p>
            <GradeButtons
              onGrade={(grade) => void submit(grade)}
              disabled={busy}
              preview={preview}
              formatPreview={(timestamp) => `下次 ${formatRelative(timestamp)}后`}
              suggested={suggestedGrade}
            />
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
      </section>
    </div>
  )
}
