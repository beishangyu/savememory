import { useCallback, useEffect, useMemo, useState } from 'react'
import { AttributionPanel } from '../components/AttributionPanel'
import { ClozeText } from '../components/ClozeText'
import { GradeButtons } from '../components/GradeButtons'
import { HandwritingCanvas } from '../components/HandwritingCanvas'
import { cardsRepo, conceptsRepo } from '../db/repo'
import type { Concept, ReviewGrade } from '../db/schema'
import { previewGrades } from '../fsrs/scheduler'
import { answerIsBlankContent } from '../lib/cloze'
import { formatRelative } from '../lib/date'
import { QUESTION_TYPE_LABEL } from '../llm/prompts'
import { useDueCount } from '../hooks/useDueCount'
import { useStudyShortcuts } from '../hooks/useStudyShortcuts'
import {
  cardCategories,
  loadCardCategories,
  loadLibraryCategories,
  tallyCardCategories,
  type CategoryTally,
} from '../services/categories'
import { buildSessionQueue, countTopics } from '../services/session'
import { useSettings } from '../store/settings'
import { useScope } from '../store/scope'
import { selectCurrentCard, selectSessionFinished, useStudy } from '../store/study'

const VERDICT_LABEL = {
  correct: '正确',
  partial: '部分正确',
  incorrect: '错误',
} as const

export default function StudyPage() {
  const settings = useSettings((state) => state.settings)
  const dueCount = useDueCount(10_000)
  /**
   * AI judging is opt-in and off by default — the classic flashcard flow is
   * the product. The plumbing stays in place for when it is switched back on.
   */
  const [aiEnabled, setAiEnabled] = useState(false)
  const aiMode = settings.gradingMode === 'ai' && aiEnabled

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
  const selectedOption = useStudy((state) => state.selectedOption)
  const attribution = useStudy((state) => state.attribution)
  const start = useStudy((state) => state.start)
  const setUserAnswer = useStudy((state) => state.setUserAnswer)
  const reveal = useStudy((state) => state.reveal)
  const selectOption = useStudy((state) => state.selectOption)
  const judge = useStudy((state) => state.judge)
  const attributeCause = useStudy((state) => state.attributeCause)
  const skipAttribution = useStudy((state) => state.skipAttribution)
  const submit = useStudy((state) => state.submit)
  const reset = useStudy((state) => state.reset)

  const card = useStudy(selectCurrentCard)
  const finished = useStudy(selectSessionFinished)
  const started = queue.length > 0

  /**
   * Keyboard shortcuts (Space / 1-4) and phone swipes only make sense while
   * a card is on screen — not on the start screen, the summary, or while the
   * "why did you miss it" question is up.
   */
  const shortcutsActive = started && !finished && !attribution && Boolean(card)
  const handleGrade = useCallback((grade: ReviewGrade) => {
    void submit(grade)
  }, [submit])
  const shortcuts = useStudyShortcuts({
    active: shortcutsActive,
    revealed,
    busy,
    onReveal: reveal,
    onGrade: handleGrade,
  })

  const [concept, setConcept] = useState<Concept | null>(null)
  const [preview, setPreview] = useState<Record<ReviewGrade, number> | null>(null)
  const [starting, setStarting] = useState(false)
  /** The category the session is limited to; `null` means everything. */
  const category = useScope((state) => state.category)
  const setCategory = useScope((state) => state.setCategory)
  /** Every category in the library, with the number of cards it holds. */
  const [libraryCategories, setLibraryCategories] = useState<CategoryTally[]>([])
  /** How many due cards each category holds. */
  const [categoryCounts, setCategoryCounts] = useState<Map<string, number>>(new Map())
  /** Keyboard or stylus input for the free-text answer. */
  const [inputMode, setInputMode] = useState<'keyboard' | 'ink'>('keyboard')
  /** The hand-written answer as a PNG blob. */
  const [inkBlob, setInkBlob] = useState<Blob | null>(null)

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

  // A new card starts with a clean answer slate.
  useEffect(() => {
    setInkBlob(null)
    setInputMode('keyboard')
  }, [index])

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
      const categoriesOf = await loadCardCategories(due)
      // Interleaving mixes topics so one concept is never drilled to death.
      const scoped = category
        ? due.filter((card) => cardCategories(card, categoriesOf).includes(category))
        : due
      start(buildSessionQueue(scoped, settings.sessionOrder))
    } finally {
      setStarting(false)
    }
  }

  const stats = useMemo(() => {
    const counts = { again: 0, hard: 0, good: 0, easy: 0 }
    for (const result of results) counts[result.grade] += 1
    return counts
  }, [results])

  const topicCount = useMemo(() => countTopics(queue), [queue])

  // The categories of the cards that are due right now, so the user can pick
  // what to work on. The list itself comes from the card library, so the two
  // always show the same categories.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [library, due] = await Promise.all([
        loadLibraryCategories(),
        cardsRepo.listDue(Date.now()),
      ])
      const categoriesOf = await loadCardCategories(due)
      if (cancelled) return
      setLibraryCategories(library)
      setCategoryCounts(tallyCardCategories(due, categoriesOf))
      // A category handed over from the card library may have been deleted in
      // the meantime — drop it rather than filter by something invisible.
      const selected = useScope.getState().category
      if (selected && !library.some((entry) => entry.name === selected)) {
        useScope.getState().setCategory(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [finished])

  const studyCategories = useMemo(
    () => libraryCategories.map((entry) => entry.name),
    [libraryCategories],
  )

  const visibleDue =
    category === null ? dueCount : categoryCounts.get(category) ?? 0

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
          <div className="due-big">{visibleDue}</div>
          <p className="muted">
            张卡片已到期{category ? ` · 只学「${category}」` : ''}
          </p>

          {studyCategories.length > 0 && (
            <>
              <p className="muted small study-scope-label">按分类学习</p>
              <div className="category-bar">
                <button
                  type="button"
                  className={`chip chip-filter${category === null ? ' active' : ''}`}
                  onClick={() => setCategory(null)}
                >
                  全部
                  <span className="chip-count">{dueCount}</span>
                </button>
                {studyCategories.map((name) => {
                  const total =
                    libraryCategories.find((entry) => entry.name === name)?.cards ?? 0
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`chip chip-filter${category === name ? ' active' : ''}`}
                      title={`共 ${total} 张卡片`}
                      onClick={() => setCategory(category === name ? null : name)}
                    >
                      {name}
                      <span className="chip-count">
                        {categoryCounts.get(name) ?? 0}/{total}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleStart}
            disabled={starting || visibleDue === 0}
          >
            {starting ? '加载中…' : visibleDue === 0 ? '暂无到期卡片' : '开始学习'}
          </button>
          {visibleDue === 0 && (
            <p className="muted small">
              {dueCount === 0
                ? '先去「输入」页面添加材料，或等待下次到期时间。'
                : '这个分类暂时没有到期的卡片，换一个分类试试。'}
            </p>
          )}
          {aiMode && (
            <p className="muted small">当前为 AI 评判模式：写下答案后由 AI 给出档位建议。</p>
          )}
          {settings.sessionOrder === 'interleave' && dueCount > 0 && (
            <p className="muted small">已开启交错练习：不同主题的卡片会交叉出现。</p>
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
          {category && (
            <p className="muted small">本次只复习了「{category}」分类。</p>
          )}
          {topicCount > 1 && (
            <p className="muted small">覆盖了 {topicCount} 个不同主题。</p>
          )}
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

  // After a failed answer we ask why it was missed before moving on.
  if (attribution) {
    return (
      <div className="page">
        <div className="study-bar">
          <span className="muted small">进度 {Math.min(index + 1, queue.length)} / {queue.length}</span>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.round((index / queue.length) * 100)}%` }} />
          </div>
        </div>
        <section className="panel card-panel">
          <AttributionPanel
            onSelect={(cause) => void attributeCause(cause)}
            onSkip={skipAttribution}
            busy={busy}
          />
          {error && <div className="alert alert-error">{error}</div>}
        </section>
      </div>
    )
  }

  if (!card) return null

  const isSelectable = card.type === 'choice' || card.type === 'truefalse'
  /**
   * A cloze card already shows the folded content in the prompt, so whatever
   * sits in `answer` is an extra hint — the translation of the sentence.
   * Model-generated cloze cards store the blanked content there instead.
   */
  const clozeHint =
    card.type === 'cloze' && !answerIsBlankContent(card.prompt, card.answer)

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

      <section
        className="panel card-panel"
        {...shortcuts.touch}
      >
        {shortcuts.swipeHint && (
          <div className={`swipe-badge swipe-${shortcuts.swipeHint}`} aria-hidden="true">
            {shortcuts.swipeHint === 'again' ? '← 重来' : '良好 →'}
          </div>
        )}

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
          {concept?.categories?.map((category) => (
            <span key={category} className="chip chip-category">
              {category}
            </span>
          ))}
          {aiMode && !isSelectable && <span className="chip chip-ai">AI 评判</span>}
        </div>

        <h2 className="prompt">
          {card.type === 'cloze' ? (
            <ClozeText prompt={card.prompt} revealed={revealed} />
          ) : (
            card.prompt
          )}
        </h2>

        {card.type === 'choice' && card.options && (
          <div className="option-list">
            {card.options.map((option, optionIndex) => {
              const isSelected = selectedOption === optionIndex
              const isCorrect = card.correctIndex === optionIndex
              const state = !revealed ? '' : isCorrect ? 'correct' : isSelected ? 'wrong' : ''
              return (
                <button
                  key={optionIndex}
                  type="button"
                  className={`option-btn ${state}`}
                  onClick={() => selectOption(optionIndex)}
                  disabled={revealed || busy}
                >
                  <span className="option-key">{String.fromCharCode(65 + optionIndex)}</span>
                  <span className="option-text">{option}</span>
                </button>
              )
            })}
          </div>
        )}

        {card.type === 'truefalse' && (
          <div className="option-row">
            <button
              type="button"
              className={`option-btn ${
                !revealed ? '' : selectedOption === 0 ? (card.answer === '正确' ? 'correct' : 'wrong') : card.answer === '正确' ? 'muted' : ''
              }`}
              onClick={() => selectOption(0)}
              disabled={revealed || busy}
            >
              <span className="option-text">正确</span>
            </button>
            <button
              type="button"
              className={`option-btn ${
                !revealed ? '' : selectedOption === 1 ? (card.answer === '错误' ? 'correct' : 'wrong') : card.answer === '错误' ? 'muted' : ''
              }`}
              onClick={() => selectOption(1)}
              disabled={revealed || busy}
            >
              <span className="option-text">错误</span>
            </button>
          </div>
        )}

        {!isSelectable && !revealed && (
          <>
            {aiMode ? (
              <>
                <div className="field">
                  <span className="field-label">作答方式</span>
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
                  <>
                    <HandwritingCanvas
                      onChange={setInkBlob}
                      disabled={judging}
                      placeholder="用 Apple Pencil 写下你的答案…"
                    />
                    {inkBlob && (
                      <p className="muted small">
                        手写内容会作为图片交给 AI 识别后评级。
                      </p>
                    )}
                  </>
                ) : (
                  <label className="field">
                    <span className="field-label">你的答案</span>
                    <textarea
                      value={userAnswer}
                      onChange={(event) => setUserAnswer(event.target.value)}
                      placeholder="写下你记得的答案，AI 会对照参考答案给出评级…"
                      rows={4}
                      disabled={judging}
                    />
                  </label>
                )}

                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={() => void judge(undefined, inputMode === 'ink' ? inkBlob : null)}
                    disabled={judging || (inputMode === 'ink' && !inkBlob)}
                  >
                    {judging ? 'AI 评判中…' : '提交答案'}
                  </button>
                  <button type="button" className="btn" onClick={reveal} disabled={judging}>
                    跳过，直接看答案
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-small btn-ghost experimental-toggle"
                  onClick={() => setAiEnabled(false)}
                  disabled={judging}
                >
                  关闭 AI 评判
                </button>
              </>
            ) : (
              <>
                {/*
                  The classic flashcard flow: look at the prompt, recall it in
                  your head, then reveal. No typing, no model.
                */}
                <p className="recall-hint">先在脑中回忆答案，再显示答案。</p>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={reveal}
                  disabled={busy}
                  aria-keyshortcuts="Space"
                >
                  显示答案
                </button>
                <p className="shortcut-hint">
                  <kbd>空格</kbd> 显示答案
                </p>

                {/*
                  The AI toggle only shows up once the master switch in
                  「设置 → 高级 / 实验性 AI 设置」 is on — otherwise it would
                  be a button that silently does nothing.
                */}
                {settings.gradingMode === 'ai' && (
                  <button
                    type="button"
                    className="btn btn-small btn-ghost experimental-toggle"
                    onClick={() => setAiEnabled(true)}
                    disabled={busy}
                  >
                    实验性：用 AI 评判我的作答
                  </button>
                )}
              </>
            )}
          </>
        )}

        {isSelectable && !revealed && (
          <button type="button" className="btn btn-small btn-ghost" onClick={reveal}>
            想不起来，直接看答案
          </button>
        )}

        {revealed && (
          <>
            {userAnswer.trim() && (
              <div className="user-answer">
                <span className="field-label">你的答案</span>
                <p>{userAnswer}</p>
              </div>
            )}

            {selectedOption !== null && card.type === 'choice' && (
              <p className="muted small">
                你选择了 {String.fromCharCode(65 + selectedOption)}。
              </p>
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

            <div className={`answer-box${clozeHint ? ' is-hint' : ''}`}>
              <span className="field-label">{clozeHint ? '参考译文' : '参考答案'}</span>
              <p className="answer-text">{card.answer}</p>
              {clozeHint && (
                <p className="answer-context">上面高亮的就是空缺处。</p>
              )}
              {concept?.statement && (
                <p className="answer-context">所属概念：{concept.statement}</p>
              )}
            </div>

            <p className="muted small">
              {suggestedGrade
                ? '已经给出档位建议，你可以直接采用，也可以改选其他档位。'
                : '回想得怎么样？选择对应档位，FSRS 会据此安排下次复习。'}
            </p>
            <GradeButtons
              onGrade={(grade) => void submit(grade)}
              disabled={busy}
              preview={preview}
              formatPreview={(timestamp) => `下次 ${formatRelative(timestamp)}后`}
              suggested={suggestedGrade}
              showShortcuts
            />

            <p className="swipe-hint">
              左滑重来 · 右滑良好
            </p>
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
      </section>
    </div>
  )
}
