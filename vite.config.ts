import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// The PWA plugin must not run inside the test runner.
const isTest = process.env.VITEST === 'true'

export default defineConfig({
  plugins: [
    react(),
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
