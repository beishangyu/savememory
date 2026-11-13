import type { ReactNode } from 'react'

export type TabKey = 'ingest' | 'study' | 'library' | 'settings'

/** Large, clear line icons — sized for comfortable thumb tapping. */
const ICONS: Record<TabKey, ReactNode> = {
  ingest: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  study: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10a2 2 0 0 1 2 2v12a1.6 1.6 0 0 0-1.6-1.6H5.5A2.5 2.5 0 0 1 3 14.9z" />
      <path d="M21 7.5A2.5 2.5 0 0 0 18.5 5H14a2 2 0 0 0-2 2v12a1.6 1.6 0 0 1 1.6-1.6h4.9A2.5 2.5 0 0 0 21 14.9z" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.5" />
      <path d="M16.2 5.4l3.4 1a1.5 1.5 0 0 1 .95 1.9l-3.5 11.7a1.5 1.5 0 0 1-1.9.95l-3.4-1a1.5 1.5 0 0 1-.95-1.9l3.5-11.7a1.5 1.5 0 0 1 1.9-.95z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1z" />
    </>
  ),
}

interface TabBarProps {
  active: TabKey
  onChange: (key: TabKey) => void
  dueCount: number
}

export function TabBar({ active, onChange, dueCount }: TabBarProps) {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'ingest', label: '输入' },
    { key: 'study', label: '学习' },
    { key: 'library', label: '卡片库' },
    { key: 'settings', label: '设置' },
  ]

  return (
    <nav className="tabbar" aria-label="主导航">
      {tabs.map((tab) => {
        const isActive = active === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            className={`tab-btn ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="tab-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {ICONS[tab.key]}
              </svg>
              {tab.key === 'study' && dueCount > 0 && (
                <span className="tab-badge">{dueCount > 99 ? '99+' : dueCount}</span>
              )}
            </span>
            <span className="tab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
