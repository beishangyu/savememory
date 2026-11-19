/**
 * The word lists that ship with the app.
 *
 * The raw text is loaded on demand with `import.meta.glob`, so the lists
 * never end up in the main bundle — the user only downloads a list when they
 * actually pick it. Each list becomes its own small chunk, which the service
 * worker precaches like any other asset.
 */
const rawFiles = import.meta.glob('../../data/*.txt', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export interface BuiltinList {
  /** Stable identifier. */
  key: string
  /** The title the material is stored under. */
  title: string
  /** A short name, used as the default category. */
  shortName: string
  /** The file name inside `data/`. */
  file: string
  /** How many words the list holds. */
  count: number
  /** A one-line description shown next to the title. */
  description: string
  /** Reads the raw text of the list. */
  load: () => Promise<string>
}

function define(
  key: string,
  title: string,
  shortName: string,
  file: string,
  count: number,
  description: string,
): BuiltinList {
  const path = `../../data/${file}`
  const loader = rawFiles[path]
  return {
    key,
    title,
    shortName,
    file,
    count,
    description,
    load: async () => {
      if (!loader) throw new Error(`找不到内置词表：${file}`)
      return loader()
    },
  }
}

/** The word lists that come with the app. */
export const BUILTIN_LISTS: BuiltinList[] = [
  define('cet4', '大学英语四级核心词汇', '四级', 'cet4.txt', 4500, '四级大纲高频词'),
  define('cet6', '大学英语六级核心词汇', '六级', 'cet6.txt', 4008, '六级进阶词'),
  define('kaoyan', '考研英语核心词汇', '考研', 'kaoyan.txt', 5000, '考研高频词'),
]
