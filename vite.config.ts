import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// The PWA plugin must not run inside the test runner.
const isTest = process.env.VITEST === 'true'

/**
 * Dev-only collector for on-device diagnostics.
 *
 * A device posts the raw pointer/scroll log to `/__diag`; it is appended to
 * `diag/telemetry.jsonl` so it can be read from the development machine.
 * This is the only reliable way to debug input behaviour that only
 * reproduces on a specific tablet.
 */
function diagCollector() {
  return {
    name: 'diag-collector',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, fn: Middleware) => void } }) {
      server.middlewares.use('/__diag', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk
        })
        req.on('end', () => {
          try {
            const record = { receivedAt: new Date().toISOString(), ...JSON.parse(body) }
            const dir = resolve(process.cwd(), 'diag')
            mkdirSync(dir, { recursive: true })
            appendFileSync(resolve(dir, 'telemetry.jsonl'), `${JSON.stringify(record)}\n`)
            res.statusCode = 200
            res.end('ok')
          } catch (error) {
            res.statusCode = 400
            res.end(`bad payload: ${String(error)}`)
          }
        })
      })
    },
  }
}

type Middleware = (
  req: { method?: string; on: (event: string, cb: (arg: never) => void) => void },
  res: { statusCode: number; end: (body?: string) => void },
) => void

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    ...(isTest ? [] : [diagCollector()]),
    ...(isTest
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: [
              'favicon.svg',
              'icon-192.png',
              'icon-512.png',
              'icon-maskable-512.png',
              'apple-touch-icon.png',
            ],
            manifest: {
              name: '记忆训练',
              short_name: '记忆训练',
              description:
                '本地优先的个人记忆训练应用：输入任意材料，自动生成提取练习，并由 FSRS 安排复习。',
              lang: 'zh-CN',
              start_url: '/',
              scope: '/',
              id: '/',
              display: 'standalone',
              orientation: 'any',
              background_color: '#0f1115',
              theme_color: '#0f1115',
              categories: ['education', 'productivity'],
              icons: [
                {
                  src: 'icon-192.png',
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'icon-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'icon-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
              navigateFallback: 'index.html',
              cleanupOutdatedCaches: true,
              clientsClaim: true,
              skipWaiting: true,
              maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
            },
            devOptions: {
              enabled: false,
            },
          }),
        ]),
  ],
  server: {
    // Listen on every interface so the phone on the same Wi-Fi can reach the
    // dev server: http://<lan-ip>:5173
    host: '0.0.0.0',
    port: 5173,
    headers: {
      // Never let a device cache the bundle — otherwise a stale build keeps
      // running on the tablet and it is impossible to tell which code it runs.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    // The app is a single page whose bundle is precached by the service
    // worker, so a single ~500 kB chunk is the right trade-off here.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
