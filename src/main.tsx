import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'
import './dev'

// Register the service worker so the app can be installed and run offline.
// `autoUpdate` means a new build is picked up on the next launch.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (import.meta.env.DEV) return
    if (window.confirm('发现新版本，是否立即更新？')) {
      void updateSW(true)
    }
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
