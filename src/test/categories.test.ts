import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { conceptsRepo } from '../db/repo'
import type { Concept } from '../db/schema'
import {
  addCategoryToConcepts,
  conceptCategories,
  normalizeCategory,
  setConceptCategories,
  tallyCategories,
  toggleCategory,
} from '../services/categories'

function makeConcept(id: string, categories?: string[]): Concept {
  return {
    id,
    sourceId: 'src-1',
    index: 0,
    title: id,
    statement: id,
    tags: [],
    categories,
    createdAt: Date.now(),
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('分类名字', () => {
  it('去掉首尾空格并合并中间的空白', () => {
    expect(normalizeCategory('  四级  ')).toBe('四级')
    expect(normalizeCategory('口语  日常')).toBe('口语 日常')
  })

  it('限制长度', () => {
    expect(normalizeCategory('a'.repeat(50))).toHaveLength(20)
  })

  it('空白变成空串', () => {
    expect(normalizeCategory('   ')).toBe('')
  })
})

describe('增删分类', () => {
  it('加上一个新分类', () => {
    expect(toggleCategory([], '四级')).toEqual(['四级'])
    expect(toggleCategory(['口语'], '四级')).toEqual(['口语', '四级'])
  })

  it('再点一次就是移除', () => {
    expect(toggleCategory(['口语', '四级'], '四级')).toEqual(['口语'])
  })

  it('不会重复', () => {
    expect(toggleCategory(['四级'], '四级')).toEqual([])
  })

  it('空名字被忽略', () => {
    expect(toggleCategory(['四级'], '  ')).toEqual(['四级'])
  })

  it('数量有上限', () => {
    let categories: string[] = []
    for (let index = 0; index < 20; index += 1) {
      categories = toggleCategory(categories, `分类${index}`)
    }
    expect(categories.length).toBeLessThanOrEqual(8)
  })
})

describe('分类统计', () => {
  it('数出每个分类有多少词条和卡片', () => {
    const concepts = [
      makeConcept('a', ['四级']),
      makeConcept('b', ['四级', '口语']),
      makeConcept('c', ['口语']),
      makeConcept('d'),
    ]
    const cardCounts = new Map([
      ['a', 2],
      ['b', 1],
      ['c', 3],
      ['d', 1],
    ])

    const tallies = tallyCategories(concepts, cardCounts)

    expect(tallies).toHaveLength(2)
    expect(tallies[0]).toEqual({ name: '口语', concepts: 2, cards: 4 })
    expect(tallies[1]).toEqual({ name: '四级', concepts: 2, cards: 3 })
  })

  it('没有分类的词条不计入', () => {
    expect(tallyCategories([makeConcept('a')], new Map())).toEqual([])
  })
})

describe('写入分类', () => {
  it('整体替换并落库', async () => {
    const concept = makeConcept('a', ['旧分类'])
    await conceptsRepo.bulkPut([concept])

    await setConceptCategories([concept], ['四级', '口语'])

    const stored = await conceptsRepo.get('a')
    expect(stored?.categories).toEqual(['四级', '口语'])
  })

  it('会去掉重复和空名字', async () => {
    const concept = makeConcept('a')
    await conceptsRepo.bulkPut([concept])

    await setConceptCategories([concept], ['四级', '四级', '  '])

    const stored = await conceptsRepo.get('a')
    expect(stored?.categories).toEqual(['四级'])
  })

  it('给一整份材料加分类', async () => {
    const concepts = [makeConcept('a'), makeConcept('b', ['口语'])]
    await conceptsRepo.bulkPut(concepts)

    await addCategoryToConcepts(concepts, '四级')

    expect(conceptCategories((await conceptsRepo.get('a'))!)).toEqual(['四级'])
    expect(conceptCategories((await conceptsRepo.get('b'))!)).toEqual(['口语', '四级'])
  })

  it('分类有上限', async () => {
    const concept = makeConcept('a')
    await conceptsRepo.bulkPut([concept])

    await setConceptCategories([concept], [
      '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    ])

    const stored = await conceptsRepo.get('a')
    expect(stored?.categories).toHaveLength(8)
  })
})
