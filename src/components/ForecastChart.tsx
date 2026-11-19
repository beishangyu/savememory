import { formatDate } from '../lib/date'
import type { ForecastDay } from '../fsrs/scheduler'

interface ForecastChartProps {
  days: ForecastDay[]
}

/**
 * A small bar chart of the expected review load for the next few days.
 *
 * Plain divs with a height — no charting library.
 */
export function ForecastChart({ days }: ForecastChartProps) {
  const max = Math.max(1, ...days.map((day) => day.count))

  return (
    <div className="forecast">
      {days.map((day, index) => {
        const date = new Date(day.dayStart)
        // The forecast always starts with today.
        const isToday = index === 0
        const percent = Math.round((day.count / max) * 100)
        return (
          <div key={day.dayStart} className={`forecast-col${isToday ? ' forecast-today' : ''}`}>
            <span className="forecast-count">{day.count}</span>
            <div className="forecast-track">
              {day.count > 0 && (
                <div
                  className="forecast-bar"
                  style={{ height: `${Math.max(6, percent)}%` }}
                  title={`${formatDate(day.dayStart)}：预计 ${day.count} 张`}
                />
              )}
            </div>
            <span className="forecast-label">{isToday ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`}</span>
          </div>
        )
      })}
    </div>
  )
}
