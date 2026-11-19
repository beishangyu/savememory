import { useEffect, useState } from 'react'
import { ContributionHeatmap } from '../components/ContributionHeatmap'
import { ForecastChart } from '../components/ForecastChart'
import { loadStats, type StatsBundle } from '../services/stats'
import { useSettings } from '../store/settings'

export default function StatsPage() {
  const settings = useSettings((state) => state.settings)
  const desiredRetention = settings.desiredRetention
  const maximumInterval = settings.maximumInterval

  const [data, setData] = useState<StatsBundle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadStats({ desiredRetention, maximumInterval })
      .then((bundle) => {
        if (!cancelled) {
          setData(bundle)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [desiredRetention, maximumInterval])

  const overview = data?.overview

  return (
    <div className="page">
      <header className="page-head">
        <h1>统计</h1>
        <p className="muted">
          所有数字都来自这台设备上的本地数据库，不联网、不上传。
        </p>
      </header>

      <section className="panel">
        <h2>概览</h2>
        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-value">{overview?.dueToday ?? '—'}</span>
            <span className="stat-label">今日待复习</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{overview?.reviewedToday ?? '—'}</span>
            <span className="stat-label">今日已复习</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{overview?.totalCards ?? '—'}</span>
            <span className="stat-label">总卡片数</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{overview?.totalReviews ?? '—'}</span>
            <span className="stat-label">总复习次数</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>复习热力图</h2>
        <p className="muted small">过去一年每天的复习量，颜色越深表示当天复习得越多。</p>
        {data ? (
          <ContributionHeatmap days={data.heatmap} />
        ) : (
          <p className="muted">读取中…</p>
        )}
      </section>

      <section className="panel">
        <h2>未来 7 天预计复习量</h2>
        <p className="muted small">
          按「良好」档模拟每张卡片的后续安排，让你提前知道明天大概要背多少张。
        </p>
        {data ? (
          <>
            <ForecastChart days={data.forecast} />
            <p className="muted small forecast-note">
              预计 7 天内共 {data.forecast.reduce((sum, day) => sum + day.count, 0)} 张，
              平均每天 {Math.round(
                data.forecast.reduce((sum, day) => sum + day.count, 0) / (data.forecast.length || 1),
              )} 张。
            </p>
          </>
        ) : (
          <p className="muted">读取中…</p>
        )}
      </section>

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}
