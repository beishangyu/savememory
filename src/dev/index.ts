import { db } from '../db/db'

/**
 * Dev-only helpers exposed on `window` so the app can be inspected and seeded
 * from the browser console. Stripped from production builds.
 */
if (import.meta.env.DEV) {
  const load = async () => {
    const { seedDemoData } = await import('./seed')
    return seedDemoData
  }

  ;(window as unknown as Record<string, unknown>).__memory = {
    db,
    async seedDemo() {
      const seed = await load()
      const result = await seed()
      console.log(`已写入演示数据：${result.cards.length} 张卡片`)
      return result
    },
    async clear() {
      await db.delete()
      location.reload()
    },
  }
}
