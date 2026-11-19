import { cardsRepo, conceptsRepo } from '../db/repo'
import type { Card, Concept } from '../db/schema'

/** How long a category name may be. */
const MAX_LENGTH = 20

/** The most categories one concept may carry. */
const MAX_PER_CONCEPT = 8

/**
 * Normalises a category name: trimmed, collapsed whitespace and capped in
 * length. Returns an empty string when nothing usable is left.
 */
export function normalizeCategory(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH)
}

/**
 * Adds a category to a list, or removes it when it is already there.
 * The list keeps its order and never holds duplicates.
 */
export function toggleCategory(categories: string[], name: string): string[] {
  const clean = normalizeCategory(name)
  if (!clean) return categories
  if (categories.includes(clean)) {
    return categories.filter((item) => item !== clean)
  }
  if (categories.length >= MAX_PER_CONCEPT) return categories
  return [...categories, clean]
}

/** The categories of a concept, always as an array. */
export function conceptCategories(concept: Concept): string[] {
  return concept.categories ?? []
}

export interface CategoryTally {
  name: string
  /** How many concepts carry the category. */
  concepts: number
  /** How many cards belong to those concepts. */
  cards: number
}

/**
 * Counts the categories across a set of concepts.
 *
 * `cardCounts` maps a concept id to the number of cards it owns.
 */
export function tallyCategories(
  concepts: Concept[],
  cardCounts: Map<string, number>,
): CategoryTally[] {
  const map = new Map<string, CategoryTally>()
  for (const concept of concepts) {
    const cards = cardCounts.get(concept.id) ?? 0
    for (const category of conceptCategories(concept)) {
      const tally = map.get(category) ?? { name: category, concepts: 0, cards: 0 }
      tally.concepts += 1
      tally.cards += cards
      map.set(category, tally)
    }
  }
  return [...map.values()].sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name))
}

/**
 * Writes new categories onto concepts.
 *
 * The concepts are updated one by one so that the schema stays schemaless —
 * no database migration is needed for a new field.
 */
export async function setConceptCategories(
  concepts: Concept[],
  categories: string[],
): Promise<void> {
  const clean = categories.map(normalizeCategory).filter(Boolean)
  const unique = [...new Set(clean)].slice(0, MAX_PER_CONCEPT)
  const updated = concepts.map((concept) => ({ ...concept, categories: unique }))
  await conceptsRepo.bulkPut(updated)
}

/** Adds one category to every given concept, keeping the ones already there. */
export async function addCategoryToConcepts(
  concepts: Concept[],
  name: string,
): Promise<void> {
  const clean = normalizeCategory(name)
  if (!clean) return
  const updated = concepts.map((concept) => ({
    ...concept,
    categories: toggleCategory(conceptCategories(concept), clean),
  }))
  await conceptsRepo.bulkPut(updated)
}

/**
 * Every category in the library, with how many concepts and cards carry it.
 *
 * This is the list the card library shows — and the one the study page
 * offers, so the two always agree.
 */
export async function loadLibraryCategories(): Promise<CategoryTally[]> {
  const [concepts, cards] = await Promise.all([
    conceptsRepo.listAll(),
    cardsRepo.listAll(),
  ])
  const cardCounts = new Map<string, number>()
  for (const card of cards) {
    cardCounts.set(card.conceptId, (cardCounts.get(card.conceptId) ?? 0) + 1)
  }
  return tallyCategories(concepts, cardCounts)
}

/**
 * The categories of a set of cards, resolved through their concepts.
 *
 * The map is keyed by concept id, so a card's categories are one lookup away.
 */
export async function loadCardCategories(cards: Card[]): Promise<Map<string, string[]>> {
  const conceptIds = [...new Set(cards.map((card) => card.conceptId))]
  if (conceptIds.length === 0) return new Map()

  const concepts = await conceptsRepo.bulkGet(conceptIds)
  const map = new Map<string, string[]>()
  concepts.forEach((concept, index) => {
    if (concept) map.set(conceptIds[index], conceptCategories(concept))
  })
  return map
}

/**
 * Counts how many cards fall into each category.
 *
 * `categoriesOf` maps a concept id to its categories.
 */
export function tallyCardCategories(
  cards: Card[],
  categoriesOf: Map<string, string[]>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const category of categoriesOf.get(card.conceptId) ?? []) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return counts
}

/** The categories of a card, resolved through its concept. */
export function cardCategories(
  card: Card,
  categoriesOf: Map<string, string[]>,
): string[] {
  return categoriesOf.get(card.conceptId) ?? []
}

/**
 * Applies a bulk edit to a set of concepts.
 *
 * `added` categories are put on every concept, `removed` ones are taken off
 * every concept — the other categories each concept carries are kept.
 */
export async function editCategoriesOfConcepts(
  concepts: Concept[],
  added: string[],
  removed: string[],
): Promise<void> {
  const add = added.map(normalizeCategory).filter(Boolean)
  const remove = removed.map(normalizeCategory).filter(Boolean)
  if (add.length === 0 && remove.length === 0) return

  const updated = concepts.map((concept) => {
    const kept = conceptCategories(concept).filter((name) => !remove.includes(name))
    for (const name of add) {
      if (!kept.includes(name)) kept.push(name)
    }
    return { ...concept, categories: kept }
  })
  await conceptsRepo.bulkPut(updated)
}
