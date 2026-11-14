import { useEffect, useState } from 'react'
import { GlobalInkLayer } from './components/GlobalInkLayer'
import { TabBar, type TabKey } from './components/TabBar'
import { DiagPage } from './dev/DiagPage'
import { useDueCount } from './hooks/useDueCount'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useReminders } from './hooks/useReminders'
import IngestPage from './pages/IngestPage'
import LibraryPage from './pages/LibraryPage'
import MemoPage from './pages/MemoPage'
import SettingsPage from './pages/SettingsPage'
import StudyPage from './pages/StudyPage'
import { useSettings } from './store/settings'
import { useInk } from './store/ink'

const ROUTES: Array<{ key: TabKey; label: string }> = [
  { key: 'ingest', label: '输入' },
  { key: 'study', label: '学习' },
  { key: 'library', label: '卡片库' },
  { key: 'memo', label: '备忘' },
  { key: 'settings', label: '设置' },
]

export default function App() {
  const [route, setRoute] = useState<TabKey>('ingest')
  const load = useSettings((state) => state.load)
  const loaded = useSettings((state) => state.loaded)
  const dueCount = useDueCount()
  const remindersEnabled = useSettings((state) => state.settings.remindersEnabled)
  const inkEnabled = useInk((state) => state.enabled)
  const toggleInk = useInk((state) => state.toggle)

  // Ink preferences live in the settings so they survive a reload and travel
  // with a backup; mirror them into the ink store once they are loaded.
  const inkColor = useSettings((state) => state.settings.inkColor)
  const inkPressure = useSettings((state) => state.settings.inkPressure)
  useEffect(() => {
    useInk.setState({ color: inkColor, pressureStrength: inkPressure })
  }, [inkColor, inkPressure])

  // Development-only diagnostics page.
  const [diag] = useState(
    () => import.meta.env.DEV && window.location.hash.startsWith('#diag'),
  )
  // The badge and the "cards are due" notification are global, not per page.
  useReminders(remindersEnabled, dueCount)
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

  if (diag) {
    return (
      <>
        <DiagPage />
        {/* The real overlay, so the diagnostics measure the real thing. */}
        <GlobalInkLayer />
      </>
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
            <button
              type="button"
              className={`nav-btn nav-ink ${inkEnabled ? 'active' : ''}`}
              onClick={toggleInk}
              aria-pressed={inkEnabled}
              title="全局手写：可以在任意页面上书写"
            >
              ✍ 手写
            </button>
          </nav>
        </header>
      )}

      <main className="main">
        {route === 'ingest' && <IngestPage />}
        {route === 'study' && <StudyPage />}
        {route === 'library' && <LibraryPage />}
        {route === 'memo' && <MemoPage />}
        {route === 'settings' && <SettingsPage />}
      </main>

      {/* Phone navigation */}
      {isPhone && <TabBar active={route} onChange={setRoute} dueCount={dueCount} />}

      {/* Global handwriting overlay — available on every page. */}
      <GlobalInkLayer />
    </div>
  )
}
