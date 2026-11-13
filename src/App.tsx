import { useEffect, useState } from 'react'
import { TabBar, type TabKey } from './components/TabBar'
import { useDueCount } from './hooks/useDueCount'
import { useMediaQuery } from './hooks/useMediaQuery'
import IngestPage from './pages/IngestPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import StudyPage from './pages/StudyPage'
import { useSettings } from './store/settings'

const ROUTES: Array<{ key: TabKey; label: string }> = [
  { key: 'ingest', label: '输入' },
  { key: 'study', label: '学习' },
  { key: 'library', label: '卡片库' },
  { key: 'settings', label: '设置' },
]

export default function App() {
  const [route, setRoute] = useState<TabKey>('ingest')
  const load = useSettings((state) => state.load)
  const loaded = useSettings((state) => state.loaded)
  const dueCount = useDueCount()
  // Exactly one navigation is rendered: the top bar on wide screens, the
  // bottom tab bar on phones.
  const isPhone = useMediaQuery('(max-width: 767px)')

  useEffect(() => {
    void load()
  }, [load])

  if (!loaded) {
    return (
      <div className="app">
        <div className="loading">正在载入本地数据…</div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Desktop / tablet navigation */}
      {!isPhone && (
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">忆</span>
            <span className="brand-text">记忆训练</span>
          </div>
          <nav className="nav" aria-label="主导航">
            {ROUTES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-btn ${route === item.key ? 'active' : ''}`}
                onClick={() => setRoute(item.key)}
                aria-current={route === item.key ? 'page' : undefined}
              >
                {item.label}
                {item.key === 'study' && dueCount > 0 && (
                  <span className="nav-badge">{dueCount}</span>
                )}
              </button>
            ))}
          </nav>
        </header>
      )}

      <main className="main">
        {route === 'ingest' && <IngestPage />}
        {route === 'study' && <StudyPage />}
        {route === 'library' && <LibraryPage />}
        {route === 'settings' && <SettingsPage />}
      </main>

      {/* Phone navigation */}
      {isPhone && <TabBar active={route} onChange={setRoute} dueCount={dueCount} />}
    </div>
  )
}
