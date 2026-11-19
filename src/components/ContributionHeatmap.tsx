import { useMemo } from 'react'
import { formatDate } from '../lib/date'
import type { HeatmapDay } from '../services/stats'

interface ContributionHeatmapProps {
  days: HeatmapDay[]
}

const MONTH_LABEL = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/**
 * GitHub-style contribution graph: one column per week, one row per weekday.
 *
 * Drawn with plain CSS grid — no charting library, no canvas, no SVG.
 */
export function ContributionHeatmap({ days }: ContributionHeatmapProps) {
  // The grid is stored column-major (week → weekday), which is exactly the
  // order a CSS grid with `grid-auto-flow: column` wants.
  const weeks = useMemo(() => {
    const columns: HeatmapDay[][] = []
    for (let index = 0; index < days.length; index += 7) {
      columns.push(days.slice(index, index + 7))
    }
    return columns
  }, [days])

  // A month label sits above the first week of a new month.
  const monthLabels = useMemo(() => {
    const labels: Array<{ index: number; text: string }> = []
    let lastMonth = -1
    weeks.forEach((week, index) => {
      const first = week[0]
      if (!first) return
      const month = new Date(first.dayStart).getMonth()
      if (month !== lastMonth) {
        lastMonth = month
        labels.push({ index, text: MONTH_LABEL[month] })
      }
    })
    return labels
  }, [weeks])

  const total = days.reduce((sum, day) => sum + day.count, 0)
  const activeDays = days.filter((day) => day.count > 0).length

  return (
    <div className="heatmap">
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">
          <span style={{ gridRow: 2 }}>一</span>
          <span style={{ gridRow: 4 }}>三</span>
          <span style={{ gridRow: 6 }}>五</span>
        </div>

        <div className="heatmap-scroll">
          <div className="heatmap-months" aria-hidden="true">
            {monthLabels.map((label) => (
              <span
                key={`${label.index}-${label.text}`}
                className="heatmap-month"
                style={{ gridColumn: label.index + 1 }}
              >
                {label.text}
              </span>
            ))}
          </div>

          <div
            className="heatmap-grid"
            role="img"
            aria-label={`过去一年共复习 ${total} 次，有 ${activeDays} 天有复习记录`}
          >
            {days.map((day) => (
              <div
                key={day.dayStart}
                className={`heat-cell heat-${day.level}${day.future ? ' heat-future' : ''}`}
                title={`${formatDate(day.dayStart)}：${day.count} 次复习`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="heatmap-legend">
        <span className="muted small">过去一年 {total} 次复习 · {activeDays} 天</span>
        <span className="heat-legend-scale">
          <span className="muted small">少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`heat-cell heat-${level}`} />
          ))}
          <span className="muted small">多</span>
        </span>
      </div>
    </div>
  )
}
